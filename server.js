require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

/* =========================================================
   MERCADO CONFIG
========================================================= */

const PORT = Number(process.env.PORT || 10000);

const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, "");

const CORS_ORIGIN =
  process.env.CORS_ORIGIN || "*";

const FRONTEND_SUCCESS_URL =
  process.env.FRONTEND_SUCCESS_URL ||
  `${PUBLIC_BASE_URL}/#confirm`;

const FRONTEND_CANCEL_URL =
  process.env.FRONTEND_CANCEL_URL ||
  `${PUBLIC_BASE_URL}/#payment`;


/* =========================================================
   GATEPAY
========================================================= */

const GATEPAY_API =
  "https://api.gatepay.to/pay.php";

const GATEPAY_WALLET =
  process.env.GATEPAY_WALLET_ADDRESS || "";

const GATEPAY_CURRENCY =
  process.env.GATEPAY_CURRENCY || "USD";


/* =========================================================
   EBAY
========================================================= */

const EBAY_CLIENT_ID =
  process.env.EBAY_CLIENT_ID || "";

const EBAY_CLIENT_SECRET =
  process.env.EBAY_CLIENT_SECRET || "";

const EBAY_ENVIRONMENT =
  String(
    process.env.EBAY_ENVIRONMENT || "production"
  ).toLowerCase();

const EBAY_API_BASE =
  EBAY_ENVIRONMENT === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";

const EBAY_TOKEN_URL =
  `${EBAY_API_BASE}/identity/v1/oauth2/token`;

const EBAY_BROWSE_URL =
  `${EBAY_API_BASE}/buy/browse/v1/item_summary/search`;

let ebayToken = null;
let ebayTokenExpiresAt = 0;


/* =========================================================
   EXPRESS
========================================================= */

app.use(
  cors({
    origin: CORS_ORIGIN
  })
);

app.use(
  express.json({
    limit: "2mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


/* =========================================================
   STATIC WEBSITE
========================================================= */

const PUBLIC_DIR =
  path.join(__dirname, "public");

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res) => {
      res.setHeader(
        "Cache-Control",
        "no-cache, no-store, must-revalidate"
      );

      res.setHeader(
        "Pragma",
        "no-cache"
      );

      res.setHeader(
        "Expires",
        "0"
      );
    }
  })
);


/* =========================================================
   DATA
========================================================= */

const DATA_DIR =
  path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

const PRODUCTS_FILE =
  path.join(DATA_DIR, "products.json");

const SUBSCRIBERS_FILE =
  path.join(DATA_DIR, "subscribers.json");

const REVIEWS_FILE =
  path.join(DATA_DIR, "reviews.json");

const PRODUCT_VIEWS_FILE =
  path.join(DATA_DIR, "product-views.json");

const ORDERS_FILE =
  path.join(DATA_DIR, "orders.json");


/* =========================================================
   JSON HELPERS
========================================================= */

function readJSON(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    const content =
      fs.readFileSync(file, "utf8").trim();

    if (!content) {
      return fallback;
    }

    return JSON.parse(content);

  } catch (error) {
    console.error(
      "JSON READ ERROR:",
      file,
      error.message
    );

    return fallback;
  }
}


function writeJSON(file, data) {
  fs.writeFileSync(
    file,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}


function ensureJSONFile(file, fallback = []) {
  if (!fs.existsSync(file)) {
    writeJSON(file, fallback);
  }
}


ensureJSONFile(PRODUCTS_FILE, []);
ensureJSONFile(SUBSCRIBERS_FILE, []);
ensureJSONFile(REVIEWS_FILE, []);
ensureJSONFile(PRODUCT_VIEWS_FILE, []);
ensureJSONFile(ORDERS_FILE, []);


/* =========================================================
   HELPERS
========================================================= */

function createId(prefix = "M") {
  return (
    prefix +
    Date.now().toString(36) +
    crypto
      .randomBytes(4)
      .toString("hex")
  ).toUpperCase();
}


function safeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}


function cleanString(value, max = 500) {
  return String(value || "")
    .trim()
    .slice(0, max);
}


function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}


function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}


/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,

    service: "MERCADO",

    payment: "GatePay.to",

    gatepayConfigured:
      Boolean(GATEPAY_WALLET),

    ebayConfigured:
      Boolean(
        EBAY_CLIENT_ID &&
        EBAY_CLIENT_SECRET
      ),

    resendConfigured:
      Boolean(
        process.env.RESEND_API_KEY
      ),

    telegramConfigured:
      Boolean(
        process.env.TELEGRAM_BOT_TOKEN &&
        process.env.TELEGRAM_CHAT_ID
      ),

    time:
      new Date().toISOString()
  });
});


/* =========================================================
   PRODUCTS
========================================================= */

app.get("/api/products", (req, res) => {
  res.json(
    readJSON(PRODUCTS_FILE, [])
  );
});


app.get("/api/products/:id", (req, res) => {
  const products =
    readJSON(PRODUCTS_FILE, []);

  const product =
    products.find(
      item =>
        String(item.id) ===
        String(req.params.id)
    );

  if (!product) {
    return res.status(404).json({
      error: "Product not found"
    });
  }

  res.json(product);
});


/* =========================================================
   RESEND EMAIL
========================================================= */

async function sendResendEmail({
  to,
  subject,
  html,
  text
}) {
  if (!process.env.RESEND_API_KEY) {
    return {
      ok: false,
      skipped: true,
      reason:
        "RESEND_API_KEY missing"
    };
  }

  const response =
    await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.RESEND_API_KEY}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          from:
            process.env.RESEND_FROM ||
            "MERCADO <onboarding@resend.dev>",

          to:
            Array.isArray(to)
              ? to
              : [to],

          subject,

          html,

          text:
            text ||
            String(html || "")
              .replace(
                /<[^>]*>/g,
                ""
              )
        })
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.error ||
      `Resend error ${response.status}`
    );
  }

  return {
    ok: true,
    data
  };
}


async function sendEmail({
  to,
  subject,
  html,
  text
}) {
  try {
    return await sendResendEmail({
      to,
      subject,
      html,
      text
    });

  } catch (error) {
    console.error(
      "EMAIL ERROR:",
      error.message
    );

    return {
      ok: false,
      error: error.message
    };
  }
}


/* =========================================================
   EMAIL VERIFICATION
========================================================= */

const emailVerificationCodes =
  new Map();


app.post(
  "/api/email/send",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.body?.email
        );

      if (!isValidEmail(email)) {
        return res.status(400).json({
          error: "Invalid email"
        });
      }

      const code =
        Math.floor(
          1000 +
          Math.random() * 9000
        ).toString();

      emailVerificationCodes.set(
        email,
        {
          code,

          expiresAt:
            Date.now() +
            10 * 60 * 1000
        }
      );

      const result =
        await sendEmail({
          to: email,

          subject:
            "MERCADO - Email verification",

          html: `
            <div style="
              font-family:Arial,sans-serif;
              max-width:600px;
              margin:auto;
            ">

              <h2>MERCADO</h2>

              <p>
                Your verification code is:
              </p>

              <div style="
                font-size:32px;
                font-weight:bold;
                letter-spacing:8px;
                margin:25px 0;
              ">
                ${code}
              </div>

              <p>
                This code expires in 10 minutes.
              </p>

            </div>
          `,

          text:
            `Your MERCADO verification code is ${code}. ` +
            `It expires in 10 minutes.`
        });

      if (!result.ok) {
        return res.status(500).json({
          error:
            "Unable to send verification email"
        });
      }

      res.json({
        ok: true,
        message:
          "Verification code sent"
      });

    } catch (error) {
      console.error(
        "EMAIL SEND ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Email service error"
      });
    }
  }
);


app.post(
  "/api/email/verify",
  (req, res) => {
    const email =
      normalizeEmail(
        req.body?.email
      );

    const code =
      String(
        req.body?.code || ""
      ).trim();

    const record =
      emailVerificationCodes.get(
        email
      );

    if (!record) {
      return res.status(400).json({
        error:
          "No verification code found"
      });
    }

    if (
      Date.now() >
      record.expiresAt
    ) {
      emailVerificationCodes.delete(
        email
      );

      return res.status(400).json({
        error:
          "Verification code expired"
      });
    }

    if (record.code !== code) {
      return res.status(400).json({
        error:
          "Invalid verification code"
      });
    }

    emailVerificationCodes.delete(
      email
    );

    res.json({
      ok: true,
      verified: true
    });
  }
);


/* =========================================================
   TELEGRAM
========================================================= */

async function sendTelegram(message) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  const chatId =
    process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      ok: false,
      skipped: true
    };
  }

  const url =
    `https://api.telegram.org/bot${token}/sendMessage`;

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.description ||
      `Telegram error ${response.status}`
    );
  }

  return {
    ok: true,
    data
  };
}


/* =========================================================
   ORDER MESSAGE
========================================================= */

function buildOrderMessage(order) {
  const customer =
    order.customer || {};

  const items =
    Array.isArray(order.items)
      ? order.items
      : [];

  let message =
    `<b>🛒 MERCADO NEW ORDER</b>\n\n`;

  message +=
    `<b>Order:</b> ${order.orderId}\n`;

  message +=
    `<b>Payment:</b> GatePay\n`;

  message +=
    `<b>Status:</b> ${order.paymentStatus}\n`;

  message +=
    `<b>Total:</b> ${order.total} ${order.currency}\n`;

  message +=
    `<b>Date:</b> ${new Date(
      order.createdAt
    ).toLocaleString()}\n\n`;

  message +=
    `<b>👤 CUSTOMER</b>\n`;

  message +=
    `Name: ${
      cleanString(
        customer.name,
        200
      ) || "-"
    }\n`;

  message +=
    `Email: ${
      cleanString(
        customer.email,
        200
      ) || "-"
    }\n`;

  message +=
    `Phone: ${
      cleanString(
        customer.phone,
        100
      ) || "-"
    }\n`;

  message +=
    `Address: ${
      cleanString(
        customer.address,
        500
      ) || "-"
    }\n\n`;

  message +=
    `<b>📦 ITEMS</b>\n`;

  items.forEach(
    (item, index) => {
      const name =
        cleanString(
          item.name ||
          item.title ||
          `Product ${index + 1}`,
          200
        );

      const price =
        safeNumber(
          item.price
        );

      const qty =
        Math.max(
          1,
          Number(
            item.qty || 1
          )
        );

      message +=
        `\n${index + 1}. ${name}\n`;

      message +=
        `Price: ${price}\n`;

      message +=
        `Qty: ${qty}\n`;

      if (item.sourceUrl) {
        message +=
          `Link: ${item.sourceUrl}\n`;
      }
    }
  );

  return message;
}


/* =========================================================
   CREATE ORDER
========================================================= */

app.post(
  "/api/order",
  async (req, res) => {
    try {
      const body =
        req.body || {};

      const orderId =
        cleanString(
          body.orderId ||
          createId("M"),
          100
        );

      const items =
        Array.isArray(body.items)
          ? body.items
          : [];

      const customer =
        body.customer &&
        typeof body.customer ===
          "object"
          ? body.customer
          : {};

      const total =
        safeNumber(
          body.total
        );

      if (!items.length) {
        return res.status(400).json({
          error:
            "Order has no items"
        });
      }

      if (total <= 0) {
        return res.status(400).json({
          error:
            "Invalid order total"
        });
      }

      const orders =
        readJSON(
          ORDERS_FILE,
          []
        );

      const existing =
        orders.find(
          order =>
            order.orderId ===
            orderId
        );

      if (existing) {
        return res.json({
          ok: true,
          order: existing
        });
      }

      const order = {
        orderId,

        items,

        customer,

        paymentMethod:
          "gatepay",

        paymentStatus:
          "pending",

        total,

        currency:
          GATEPAY_CURRENCY,

        createdAt:
          new Date().toISOString(),

        updatedAt:
          new Date().toISOString()
      };

      orders.push(order);

      writeJSON(
        ORDERS_FILE,
        orders
      );

      try {
        await sendTelegram(
          buildOrderMessage(
            order
          )
        );
      } catch (error) {
        console.error(
          "Telegram order error:",
          error.message
        );
      }

      res.json({
        ok: true,
        order
      });

    } catch (error) {
      console.error(
        "ORDER ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Unable to create order"
      });
    }
  }
);


/* =========================================================
   GATEPAY CREATE PAYMENT
========================================================= */

app.post(
  "/api/payment/gatepay",
  async (req, res) => {
    try {
      if (!GATEPAY_WALLET) {
        return res.status(500).json({
          error:
            "GATEPAY_WALLET_ADDRESS is not configured"
        });
      }

      const body =
        req.body || {};

      const orderId =
        cleanString(
          body.orderId,
          100
        );

      const amount =
        safeNumber(
          body.total
        );

      if (!orderId) {
        return res.status(400).json({
          error:
            "orderId is required"
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          error:
            "Invalid payment amount"
        });
      }

      /*
        Order ID is attached to callback URL.
      */

      const callbackUrl =
        `${PUBLIC_BASE_URL}/api/payment/gatepay/callback` +
        `?orderId=${encodeURIComponent(
          orderId
        )}`;

      const payload = {
        wallet:
          GATEPAY_WALLET,

        amount,

        currency:
          GATEPAY_CURRENCY,

        callback_url:
          callbackUrl
      };

      console.log(
        "GatePay request:",
        {
          orderId,
          amount,
          currency:
            GATEPAY_CURRENCY
        }
      );

      const response =
        await fetch(
          GATEPAY_API,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json"
            },

            body:
              JSON.stringify(
                payload
              )
          }
        );

      const rawText =
        await response.text();

      let data;

      try {
        data =
          JSON.parse(
            rawText
          );
      } catch {
        data = {
          raw: rawText
        };
      }

      if (!response.ok) {
        console.error(
          "GatePay HTTP error:",
          response.status,
          data
        );

        return res.status(502).json({
          error:
            "GatePay payment creation failed",

          status:
            response.status,

          details:
            data
        });
      }

      const paymentUrl =
        data?.payment_url ||
        data?.checkout_url ||
        data?.url ||
        data?.checkout ||
        data?.payment?.url ||
        data?.data?.payment_url ||
        data?.data?.checkout_url ||
        data?.data?.url ||
        data?.data?.checkout;

      if (!paymentUrl) {
        console.error(
          "No GatePay checkout URL:",
          data
        );

        return res.status(502).json({
          error:
            "GatePay did not return a checkout URL",

          response:
            data
        });
      }

      const orders =
        readJSON(
          ORDERS_FILE,
          []
        );

      let index =
        orders.findIndex(
          order =>
            order.orderId ===
            orderId
        );

      if (index === -1) {
        orders.push({
          orderId,

          items:
            Array.isArray(
              body.items
            )
              ? body.items
              : [],

          customer:
            body.customer || {},

          paymentMethod:
            "gatepay",

          paymentStatus:
            "pending",

          total: amount,

          currency:
            GATEPAY_CURRENCY,

          createdAt:
            new Date().toISOString(),

          updatedAt:
            new Date().toISOString()
        });

        index =
          orders.length - 1;
      }

      orders[index].paymentMethod =
        "gatepay";

      orders[index].total =
        amount;

      orders[index].currency =
        GATEPAY_CURRENCY;

      orders[index].gatepay = {
        paymentUrl,

        callbackUrl,

        createdAt:
          new Date().toISOString(),

        response:
          data
      };

      orders[index].updatedAt =
        new Date().toISOString();

      writeJSON(
        ORDERS_FILE,
        orders
      );

      res.json({
        ok: true,

        orderId,

        payment_url:
          paymentUrl,

        checkout_url:
          paymentUrl,

        success_url:
          FRONTEND_SUCCESS_URL,

        cancel_url:
          FRONTEND_CANCEL_URL
      });

    } catch (error) {
      console.error(
        "GATEPAY ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Unable to create GatePay payment",

        message:
          error.message
      });
    }
  }
);


/* =========================================================
   GATEPAY CALLBACK
========================================================= */

app.post(
  "/api/payment/gatepay/callback",
  async (req, res) => {
    try {
      const callback =
        req.body || {};

      console.log(
        "GatePay callback:",
        JSON.stringify(
          callback,
          null,
          2
        )
      );

      const queryOrderId =
        cleanString(
          req.query?.orderId,
          100
        );

      const orderId =
        cleanString(
          callback.order_id ||
          callback.orderId ||
          callback.merchant_order_id ||
          callback.reference ||
          callback.invoice_id ||
          callback.payment_id ||
          callback.order ||
          queryOrderId,
          100
        );

      if (!orderId) {
        return res.status(400).json({
          error:
            "Order ID missing"
        });
      }

      const status =
        String(
          callback.status ||
          callback.payment_status ||
          callback.state ||
          callback.result ||
          ""
        )
          .trim()
          .toLowerCase();

      const paidStatuses = [
        "paid",
        "completed",
        "complete",
        "success",
        "successful",
        "confirmed",
        "confirmed_payment"
      ];

      const failedStatuses = [
        "failed",
        "failure",
        "cancelled",
        "canceled",
        "expired",
        "declined"
      ];

      const orders =
        readJSON(
          ORDERS_FILE,
          []
        );

      const index =
        orders.findIndex(
          order =>
            order.orderId ===
            orderId
        );

      if (index === -1) {
        console.error(
          "Unknown order:",
          orderId
        );

        return res.json({
          ok: false,
          message:
            "Order not found"
        });
      }

      const order =
        orders[index];

      const previousStatus =
        order.paymentStatus;

      order.gatepayCallback =
        callback;

      order.gatepayCallbackReceivedAt =
        new Date().toISOString();

      if (
        paidStatuses.includes(
          status
        )
      ) {
        order.paymentStatus =
          "paid";

      } else if (
        failedStatuses.includes(
          status
        )
      ) {
        order.paymentStatus =
          "failed";

      } else {
        order.paymentStatus =
          previousStatus ||
          "pending";
      }

      order.updatedAt =
        new Date().toISOString();

      writeJSON(
        ORDERS_FILE,
        orders
      );


      /* PAYMENT CONFIRMED */

      if (
        order.paymentStatus ===
          "paid" &&
        previousStatus !==
          "paid"
      ) {

        try {
          await sendTelegram(
            `<b>✅ PAYMENT CONFIRMED</b>\n\n` +
            `<b>Order:</b> ${order.orderId}\n` +
            `<b>Amount:</b> ${order.total} ${order.currency}\n` +
            `<b>Payment:</b> GatePay\n` +
            `<b>Status:</b> PAID`
          );

        } catch (error) {
          console.error(
            "Telegram payment error:",
            error.message
          );
        }


        /* CUSTOMER EMAIL */

        const email =
          normalizeEmail(
            order.customer?.email
          );

        if (
          isValidEmail(email)
        ) {
          await sendEmail({
            to: email,

            subject:
              `MERCADO - Payment confirmed #${order.orderId}`,

            html: `
              <div style="
                font-family:Arial,sans-serif;
                max-width:600px;
                margin:auto;
              ">

                <h2>
                  Payment confirmed
                </h2>

                <p>
                  Thank you for your
                  order with MERCADO.
                </p>

                <p>
                  <strong>Order:</strong>
                  ${order.orderId}
                </p>

                <p>
                  <strong>Total:</strong>
                  ${order.total}
                  ${order.currency}
                </p>

                <p>
                  Your payment has
                  been confirmed.
                </p>

              </div>
            `,

            text:
              `Your MERCADO payment has been confirmed. ` +
              `Order ${order.orderId}. ` +
              `Total ${order.total} ${order.currency}.`
          });
        }
      }

      res.json({
        ok: true,

        orderId:
          order.orderId,

        paymentStatus:
          order.paymentStatus
      });

    } catch (error) {
      console.error(
        "CALLBACK ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Callback processing failed"
      });
    }
  }
);


/* =========================================================
   EBAY TOKEN
========================================================= */

async function getEbayToken() {
  if (
    !EBAY_CLIENT_ID ||
    !EBAY_CLIENT_SECRET
  ) {
    throw new Error(
      "eBay credentials are not configured"
    );
  }

  if (
    ebayToken &&
    Date.now() <
      ebayTokenExpiresAt - 60000
  ) {
    return ebayToken;
  }

  const credentials =
    Buffer.from(
      `${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`
    ).toString("base64");

  const response =
    await fetch(
      EBAY_TOKEN_URL,
      {
        method: "POST",

        headers: {
          Authorization:
            `Basic ${credentials}`,

          "Content-Type":
            "application/x-www-form-urlencoded",

          Accept:
            "application/json"
        },

        body:
          "grant_type=client_credentials" +
          "&scope=" +
          encodeURIComponent(
            "https://api.ebay.com/oauth/api_scope"
          )
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error_description ||
      data?.error ||
      `eBay OAuth error ${response.status}`
    );
  }

  ebayToken =
    data.access_token;

  ebayTokenExpiresAt =
    Date.now() +
    Number(
      data.expires_in || 7200
    ) * 1000;

  return ebayToken;
}


/* =========================================================
   EBAY MARKETPLACE
========================================================= */

function normalizeMarketplace(
  country
) {
  const supported = {
    US: "EBAY_US",
    GB: "EBAY_GB",
    DE: "EBAY_DE",
    FR: "EBAY_FR",
    IT: "EBAY_IT",
    ES: "EBAY_ES",
    CA: "EBAY_CA",
    AU: "EBAY_AU",
    AT: "EBAY_AT",
    BE: "EBAY_BE",
    CH: "EBAY_CH",
    IE: "EBAY_IE",
    NL: "EBAY_NL",
    PL: "EBAY_PL"
  };

  const code =
    String(
      country || "US"
    )
      .trim()
      .toUpperCase();

  return (
    supported[code] ||
    "EBAY_US"
  );
}


/* =========================================================
   EBAY SEARCH
========================================================= */

app.get(
  "/api/catalog/search",
  async (req, res) => {
    try {
      const q =
        cleanString(
          req.query.q,
          200
        );

      const country =
        String(
          req.query.country ||
          "US"
        ).toUpperCase();

      const limit =
        Math.min(
          50,
          Math.max(
            1,
            Number(
              req.query.limit ||
              20
            )
          )
        );

      if (!q) {
        return res.status(400).json({
          error:
            "Search query is required"
        });
      }

      const token =
        await getEbayToken();

      const marketplace =
        normalizeMarketplace(
          country
        );

      const url =
        new URL(
          EBAY_BROWSE_URL
        );

      url.searchParams.set(
        "q",
        q
      );

      url.searchParams.set(
        "limit",
        String(limit)
      );

      url.searchParams.set(
        "filter",
        "buyingOptions:{FIXED_PRICE}"
      );

      const response =
        await fetch(
          url.toString(),
          {
            headers: {
              Authorization:
                `Bearer ${token}`,

              "X-EBAY-C-MARKETPLACE-ID":
                marketplace,

              Accept:
                "application/json"
            }
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        return res.status(
          response.status
        ).json({
          error:
            "eBay search failed",

          details:
            data
        });
      }

      res.json(data);

    } catch (error) {
      console.error(
        "EBAY SEARCH ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Unable to search eBay",

        message:
          error.message
      });
    }
  }
);


/* =========================================================
   EBAY HOME
========================================================= */

app.get(
  "/api/catalog/home",
  async (req, res) => {
    try {
      const country =
        String(
          req.query.country ||
          "US"
        ).toUpperCase();

      const language =
        String(
          req.query.lang ||
          "en"
        );

      const token =
        await getEbayToken();

      const marketplace =
        normalizeMarketplace(
          country
        );

      const url =
        new URL(
          EBAY_BROWSE_URL
        );

      url.searchParams.set(
        "q",
        "popular products"
      );

      url.searchParams.set(
        "limit",
        "24"
      );

      url.searchParams.set(
        "filter",
        "buyingOptions:{FIXED_PRICE}"
      );

      const response =
        await fetch(
          url.toString(),
          {
            headers: {
              Authorization:
                `Bearer ${token}`,

              "X-EBAY-C-MARKETPLACE-ID":
                marketplace,

              "Accept-Language":
                language,

              Accept:
                "application/json"
            }
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        return res.status(
          response.status
        ).json({
          error:
            "eBay catalog failed",

          details:
            data
        });
      }

      res.json(data);

    } catch (error) {
      console.error(
        "EBAY HOME ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Unable to load eBay catalog",

        message:
          error.message
      });
    }
  }
);


/* =========================================================
   EBAY ITEM
========================================================= */

app.get(
  "/api/catalog/item/:itemId",
  async (req, res) => {
    try {
      const itemId =
        cleanString(
          req.params.itemId,
          200
        );

      if (!itemId) {
        return res.status(400).json({
          error:
            "Item ID is required"
        });
      }

      const token =
        await getEbayToken();

      const url =
        `${EBAY_API_BASE}/buy/browse/v1/item/${encodeURIComponent(
          itemId
        )}`;

      const response =
        await fetch(
          url,
          {
            headers: {
              Authorization:
                `Bearer ${token}`,

              "X-EBAY-C-MARKETPLACE-ID":
                "EBAY_US",

              Accept:
                "application/json"
            }
          }
        );

      const data =
        await response
          .json()
          .catch(() => ({}));

      if (!response.ok) {
        return res.status(
          response.status
        ).json({
          error:
            "eBay item lookup failed",

          details:
            data
        });
      }

      res.json(data);

    } catch (error) {
      console.error(
        "EBAY ITEM ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Unable to load eBay item",

        message:
          error.message
      });
    }
  }
);


/* =========================================================
   REVIEWS
========================================================= */

app.get(
  "/api/reviews",
  (req, res) => {
    const productId =
      cleanString(
        req.query.productId,
        200
      );

    const reviews =
      readJSON(
        REVIEWS_FILE,
        []
      );

    if (!productId) {
      return res.json(
        reviews
      );
    }

    res.json(
      reviews.filter(
        review =>
          String(
            review.productId
          ) ===
          String(productId)
      )
    );
  }
);


app.post(
  "/api/reviews",
  (req, res) => {
    const body =
      req.body || {};

    const productId =
      cleanString(
        body.productId,
        200
      );

    const rating =
      Number(
        body.rating
      );

    const comment =
      cleanString(
        body.comment,
        2000
      );

    const name =
      cleanString(
        body.name ||
        "Customer",
        100
      );

    if (!productId) {
      return res.status(400).json({
        error:
          "productId is required"
      });
    }

    if (
      !Number.isFinite(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return res.status(400).json({
        error:
          "Rating must be between 1 and 5"
      });
    }

    if (!comment) {
      return res.status(400).json({
        error:
          "Comment is required"
      });
    }

    const reviews =
      readJSON(
        REVIEWS_FILE,
        []
      );

    const review = {
      id:
        createId("R"),

      productId,

      rating,

      comment,

      name,

      createdAt:
        new Date().toISOString()
    };

    reviews.push(review);

    writeJSON(
      REVIEWS_FILE,
      reviews
    );

    res.json({
      ok: true,
      review
    });
  }
);


/* =========================================================
   PRODUCT VIEWS
========================================================= */

app.post(
  "/api/track-view",
  (req, res) => {
    const email =
      normalizeEmail(
        req.body?.email
      );

    const product =
      req.body?.product;

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error:
          "Valid email is required"
      });
    }

    if (
      !product ||
      typeof product !==
        "object"
    ) {
      return res.status(400).json({
        error:
          "Product is required"
      });
    }

    const views =
      readJSON(
        PRODUCT_VIEWS_FILE,
        []
      );

    views.push({
      id:
        createId("V"),

      email,

      product,

      viewedAt:
        new Date().toISOString(),

      reminded: false
    });

    writeJSON(
      PRODUCT_VIEWS_FILE,
      views.slice(-500)
    );

    res.json({
      ok: true
    });
  }
);


/* =========================================================
   NOTIFICATIONS
========================================================= */

app.post(
  "/api/notify/subscribe",
  (req, res) => {
    const email =
      normalizeEmail(
        req.body?.email
      );

    const query =
      cleanString(
        req.body?.query,
        500
      );

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error:
          "Invalid email"
      });
    }

    if (!query) {
      return res.status(400).json({
        error:
          "Query is required"
      });
    }

    const subscribers =
      readJSON(
        SUBSCRIBERS_FILE,
        []
      );

    const exists =
      subscribers.some(
        item =>
          item.email === email &&
          item.query === query
      );

    if (!exists) {
      subscribers.push({
        id:
          createId("S"),

        email,

        query,

        createdAt:
          new Date().toISOString()
      });

      writeJSON(
        SUBSCRIBERS_FILE,
        subscribers
      );
    }

    res.json({
      ok: true,
      subscribed: true
    });
  }
);


/* =========================================================
   ADMIN AUTH
========================================================= */

function requireAdmin(
  req,
  res,
  next
) {
  const adminKey =
    process.env.ADMIN_KEY;

  if (!adminKey) {
    return res.status(503).json({
      error:
        "ADMIN_KEY is not configured"
    });
  }

  const supplied =
    String(
      req.headers["x-admin-key"] ||
      ""
    );

  const a =
    Buffer.from(
      supplied
    );

  const b =
    Buffer.from(
      adminKey
    );

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(
      a,
      b
    )
  ) {
    return res.status(401).json({
      error:
        "Unauthorized"
    });
  }

  next();
}


/* =========================================================
   ADMIN ORDERS
========================================================= */

app.get(
  "/api/admin/orders",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,

      orders:
        readJSON(
          ORDERS_FILE,
          []
        )
    });
  }
);


app.get(
  "/api/admin/orders/:orderId",
  requireAdmin,
  (req, res) => {
    const orders =
      readJSON(
        ORDERS_FILE,
        []
      );

    const order =
      orders.find(
        item =>
          item.orderId ===
          req.params.orderId
      );

    if (!order) {
      return res.status(404).json({
        error:
          "Order not found"
      });
    }

    res.json({
      ok: true,
      order
    });
  }
);


/* =========================================================
   ADMIN SUBSCRIBERS
========================================================= */

app.get(
  "/api/admin/subscribers",
  requireAdmin,
  (req, res) => {
    res.json({
      ok: true,

      subscribers:
        readJSON(
          SUBSCRIBERS_FILE,
          []
        )
    });
  }
);


/* =========================================================
   ADMIN BROADCAST
========================================================= */

app.post(
  "/api/admin/notify-broadcast",
  requireAdmin,
  async (req, res) => {
    try {
      const query =
        cleanString(
          req.body?.query,
          500
        );

      const subject =
        cleanString(
          req.body?.subject ||
          "MERCADO - Product available",
          200
        );

      const message =
        cleanString(
          req.body?.message ||
          "The product you were looking for is now available.",
          5000
        );

      if (!query) {
        return res.status(400).json({
          error:
            "Query is required"
        });
      }

      const subscribers =
        readJSON(
          SUBSCRIBERS_FILE,
          []
        );

      const matching =
        subscribers.filter(
          subscriber =>
            String(
              subscriber.query
            ).toLowerCase() ===
            query.toLowerCase()
        );

      let sent = 0;

      for (
        const subscriber
        of matching
      ) {
        const result =
          await sendEmail({
            to:
              subscriber.email,

            subject,

            html: `
              <div style="
                font-family:Arial,sans-serif;
              ">
                <h2>MERCADO</h2>
                <p>${message}</p>
              </div>
            `,

            text:
              message
          });

        if (result.ok) {
          sent++;
        }
      }

      res.json({
        ok: true,

        matched:
          matching.length,

        sent
      });

    } catch (error) {
      console.error(
        "BROADCAST ERROR:",
        error
      );

      res.status(500).json({
        error:
          "Broadcast failed"
      });
    }
  }
);


/* =========================================================
   SPA FALLBACK
========================================================= */

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );
  }
);


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      "======================================"
    );

    console.log(
      "MERCADO SERVER STARTED"
    );

    console.log(
      "======================================"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Base URL: ${PUBLIC_BASE_URL}`
    );

    console.log(
      `GatePay: ${
        GATEPAY_WALLET
          ? "CONFIGURED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `eBay: ${
        EBAY_CLIENT_ID &&
        EBAY_CLIENT_SECRET
          ? "CONFIGURED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `Resend: ${
        process.env.RESEND_API_KEY
          ? "CONFIGURED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `Telegram: ${
        process.env.TELEGRAM_BOT_TOKEN &&
        process.env.TELEGRAM_CHAT_ID
          ? "CONFIGURED"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      "======================================"
    );
  }
);
