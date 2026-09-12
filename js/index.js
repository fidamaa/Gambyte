/**
 * Gambyte — Firebase Cloud Functions
 * Integração com Mercado Pago (backend seguro)
 *
 * SUBSTITUA as variáveis marcadas com ← VOCÊ PREENCHE
 */

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

admin.initializeApp();
const db = admin.firestore();

// ─── Configuração Mercado Pago ────────────────────────────────────────────────
// Preencha com sua Access Token do painel do Mercado Pago
// (Painel MP → Seu negócio → Credenciais → Credenciais de produção)
const MP_ACCESS_TOKEN = functions.config().mercadopago?.access_token
  || "SEU_ACCESS_TOKEN_AQUI"; // ← VOCÊ PREENCHE depois de criar conta MP

const mp = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// ─── URL do seu site (Firebase Hosting) ──────────────────────────────────────
// Após deploy: "https://SEU-PROJETO.web.app"
const SITE_URL = functions.config().app?.url
  || "https://SEU-PROJETO.web.app"; // ← VOCÊ PREENCHE com sua URL


// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 1: Criar preferência de pagamento (Mercado Pago Checkout)
// Chamada pelo frontend quando o usuário clica em "Assinar"
// ═══════════════════════════════════════════════════════════════════════════════
exports.criarPagamento = functions
  .region("southamerica-east1") // Servidor em São Paulo
  .https.onCall(async (data, context) => {

    // Segurança: usuário deve estar logado
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "Você precisa estar logado para assinar."
      );
    }

    const uid   = context.auth.uid;
    const email = context.auth.token.email;

    // Verificar se já é premium
    const userDoc = await db.collection("users").doc(uid).get();
    if (userDoc.exists && userDoc.data().premium === true) {
      throw new functions.https.HttpsError(
        "already-exists",
        "Você já possui uma assinatura Premium ativa."
      );
    }

    try {
      const preference = new Preference(mp);

      const response = await preference.create({
        body: {
          items: [
            {
              id:          "gambyte-premium-mensal",
              title:       "Gambyte Premium — Mensal",
              description: "Acesso completo a todos os insights e análise profunda",
              quantity:    1,
              currency_id: "BRL",
              unit_price:  9.90,
            },
          ],
          payer: {
            email: email,
          },
          back_urls: {
            success: `${SITE_URL}/gambyte-premium.html?status=success`,
            failure: `${SITE_URL}/gambyte-premium.html?status=failure`,
            pending: `${SITE_URL}/gambyte-premium.html?status=pending`,
          },
          auto_return:          "approved",
          notification_url:     `${SITE_URL}/api/webhook-mp`, // Cloud Function webhook
          statement_descriptor: "CHESSLENS",
          external_reference:   uid, // Usamos o UID do Firebase para identificar o usuário
          payment_methods: {
            excluded_payment_types: [],
            installments: 1, // Sem parcelamento para assinatura mensal
          },
          metadata: {
            firebase_uid: uid,
            user_email:   email,
          },
        },
      });

      // Salvar preferência no Firestore para rastreamento
      await db.collection("pagamentos").doc(response.id).set({
        uid,
        email,
        preference_id: response.id,
        status:        "pendente",
        valor:         9.90,
        criado_em:     admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        preference_id: response.id,
        init_point:    response.init_point,    // URL para redirecionar (produção)
        sandbox_init_point: response.sandbox_init_point, // URL para testes
      };

    } catch (err) {
      console.error("[criarPagamento] Erro:", err);
      throw new functions.https.HttpsError("internal", "Erro ao criar pagamento.");
    }
  });


// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 2: Webhook do Mercado Pago
// Chamada automaticamente pelo MP quando o status do pagamento muda
// ═══════════════════════════════════════════════════════════════════════════════
exports.webhookMP = functions
  .region("southamerica-east1")
  .https.onRequest(async (req, res) => {

    // MP envia POST com o tipo e ID do evento
    const { type, data } = req.body;

    console.log("[webhookMP] Evento recebido:", type, data);

    // Só processar notificações de pagamento
    if (type !== "payment") {
      return res.status(200).send("OK");
    }

    try {
      // Buscar detalhes do pagamento no MP
      const paymentApi = new Payment(mp);
      const payment    = await paymentApi.get({ id: data.id });

      console.log("[webhookMP] Payment status:", payment.status, "| UID:", payment.external_reference);

      // Pagamento aprovado → ativar Premium no Firestore
      if (payment.status === "approved") {
        const uid = payment.external_reference; // UID do Firebase

        if (!uid) {
          console.error("[webhookMP] external_reference (UID) ausente no pagamento");
          return res.status(400).send("UID ausente");
        }

        // Ativar premium no documento do usuário
        await db.collection("users").doc(uid).set(
          {
            premium:             true,
            premium_ativado_em:  admin.firestore.FieldValue.serverTimestamp(),
            mp_payment_id:       payment.id,
            mp_preference_id:    payment.preference_id,
            proximo_vencimento:  _addMonths(new Date(), 1).toISOString(),
          },
          { merge: true } // Não sobrescrever outros campos
        );

        // Atualizar registro de pagamento
        const pagQuery = await db.collection("pagamentos")
          .where("preference_id", "==", payment.preference_id)
          .limit(1)
          .get();

        if (!pagQuery.empty) {
          await pagQuery.docs[0].ref.update({
            status:        "aprovado",
            payment_id:    payment.id,
            aprovado_em:   admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        console.log(`[webhookMP] ✅ Premium ativado para UID: ${uid}`);
      }

      return res.status(200).send("OK");

    } catch (err) {
      console.error("[webhookMP] Erro ao processar:", err);
      return res.status(500).send("Erro interno");
    }
  });


// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 3: Verificar status premium do usuário (chamada ao fazer login)
// ═══════════════════════════════════════════════════════════════════════════════
exports.verificarPremium = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {

    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Não autenticado.");
    }

    const uid     = context.auth.uid;
    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return { premium: false };
    }

    const userData = userDoc.data();

    // Verificar se o premium não expirou
    if (userData.premium && userData.proximo_vencimento) {
      const vencimento = new Date(userData.proximo_vencimento);
      if (vencimento < new Date()) {
        // Expirou — desativar
        await db.collection("users").doc(uid).update({ premium: false });
        return { premium: false, motivo: "expirado" };
      }
    }

    return {
      premium:            userData.premium || false,
      premium_ativado_em: userData.premium_ativado_em || null,
      proximo_vencimento: userData.proximo_vencimento || null,
    };
  });


// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO 4: Cancelar assinatura
// ═══════════════════════════════════════════════════════════════════════════════
exports.cancelarAssinatura = functions
  .region("southamerica-east1")
  .https.onCall(async (data, context) => {

    if (!context.auth) {
      throw new functions.https.HttpsError("unauthenticated", "Não autenticado.");
    }

    const uid = context.auth.uid;

    await db.collection("users").doc(uid).update({
      premium:           false,
      cancelado_em:      admin.firestore.FieldValue.serverTimestamp(),
      proximo_vencimento: null,
    });

    return { ok: true };
  });


// ─── Helper ──────────────────────────────────────────────────────────────────
function _addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}
