import crypto from "node:crypto";
import admin from "firebase-admin";

const COLLECTIONS = {
  userDay: "admin_metrics_user_aggregate_day",
  userMonth: "admin_metrics_user_aggregate_month",
  userYear: "admin_metrics_user_aggregate_year",
  userProvider: "admin_metrics_user_aggregate_provider",
  questionEvents: "admin_metrics_question_events",
  questionDay: "admin_metrics_question_aggregate_day",
  questionMonth: "admin_metrics_question_aggregate_month",
  questionYear: "admin_metrics_question_aggregate_year",
  regulationEvents: "admin_metrics_regulation_events",
  regulationAggregate: "admin_metrics_regulation_aggregate"
};

function initAdminApp() {
  if (admin.apps.length > 0) return admin.app();

  const serviceAccountJson = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(serviceAccountJson, "base64").toString("utf-8"));
    } catch {
      parsed = JSON.parse(serviceAccountJson);
    }
    return admin.initializeApp({ credential: admin.credential.cert(parsed) });
  }

  return admin.initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  });
}

function getDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function getMonthKey(date) {
  return date.toISOString().slice(0, 7);
}

function getYearKey(date) {
  return String(date.getUTCFullYear());
}

function normalizeProvider(provider) {
  if (!provider) return "unknown";
  const trimmed = provider.trim().toLowerCase();
  if (!trimmed) return "unknown";
  if (trimmed === "password") return "email";
  if (trimmed === "google.com") return "google";
  if (trimmed === "facebook.com") return "facebook";
  return trimmed;
}

function normalizeText(value, fallback = "unknown") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function makeKey(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
}

function hashId(input) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 28);
}

function incrementMap(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

async function clearMetrics(db) {
  console.log("Clearing existing metric collections...");
  const clearSimpleCollection = async (name) => {
    const snapshot = await db.collection(name).get();
    if (snapshot.empty) return;
    const writer = db.bulkWriter();
    snapshot.docs.forEach((doc) => writer.delete(doc.ref));
    await writer.close();
  };

  await clearSimpleCollection(COLLECTIONS.userDay);
  await clearSimpleCollection(COLLECTIONS.userMonth);
  await clearSimpleCollection(COLLECTIONS.userYear);
  await clearSimpleCollection(COLLECTIONS.userProvider);
  await clearSimpleCollection(COLLECTIONS.questionEvents);
  await clearSimpleCollection(COLLECTIONS.questionDay);
  await clearSimpleCollection(COLLECTIONS.questionMonth);
  await clearSimpleCollection(COLLECTIONS.questionYear);
  await clearSimpleCollection(COLLECTIONS.regulationEvents);

  const regAggSnapshot = await db.collection(COLLECTIONS.regulationAggregate).get();
  const regWriter = db.bulkWriter();
  for (const regDoc of regAggSnapshot.docs) {
    const sourceSnapshot = await regDoc.ref.collection("sources").get();
    sourceSnapshot.docs.forEach((sourceDoc) => regWriter.delete(sourceDoc.ref));
    regWriter.delete(regDoc.ref);
  }
  await regWriter.close();
}

async function main() {
  initAdminApp();
  const db = admin.firestore();
  const auth = admin.auth();
  const shouldReset = !process.argv.includes("--no-reset");
  if (shouldReset) {
    await clearMetrics(db);
  }

  const userDay = new Map();
  const userMonth = new Map();
  const userYear = new Map();
  const userProvider = new Map();

  const questionDay = new Map();
  const questionMonth = new Map();
  const questionYear = new Map();
  const questionEvents = [];

  const regulationEvents = [];
  const regulationAggregate = new Map();

  console.log("Backfilling user creation metrics from Firebase Auth...");
  let nextToken = undefined;
  do {
    const page = await auth.listUsers(1000, nextToken);
    for (const user of page.users) {
      const creationTime = user.metadata.creationTime ? new Date(user.metadata.creationTime) : new Date();
      const provider = normalizeProvider(user.providerData[0]?.providerId);
      incrementMap(userDay, getDayKey(creationTime));
      incrementMap(userMonth, getMonthKey(creationTime));
      incrementMap(userYear, getYearKey(creationTime));
      incrementMap(userProvider, provider);
    }
    nextToken = page.pageToken;
  } while (nextToken);

  console.log("Scanning chat history for question/regulation metrics...");
  const usersSnapshot = await db.collection("users").get();
  let conversationCount = 0;
  let messageCount = 0;
  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const conversationsSnapshot = await userDoc.ref.collection("conversations").get();
    conversationCount += conversationsSnapshot.size;
    for (const conversation of conversationsSnapshot.docs) {
      const messagesSnapshot = await conversation.ref.collection("messages").orderBy("timestamp", "asc").get();
      let lastQuestion = "";
      for (const messageDoc of messagesSnapshot.docs) {
        messageCount += 1;
        const data = messageDoc.data();
        const role = normalizeText(data.role, "user");
        const content = normalizeText(data.content, "");
        const timestampValue =
          data.timestamp && typeof data.timestamp.toDate === "function"
            ? data.timestamp.toDate()
            : new Date();
        const dayKey = getDayKey(timestampValue);
        const monthKey = getMonthKey(timestampValue);
        const yearKey = getYearKey(timestampValue);

        if (role === "user" && content) {
          lastQuestion = content;
          const eventId = hashId(`${uid}:${conversation.id}:${messageDoc.id}:question`);
          questionEvents.push({
            id: eventId,
            uid,
            conversationId: conversation.id,
            question: content,
            askedAt: admin.firestore.Timestamp.fromDate(timestampValue),
            dayKey,
            monthKey,
            yearKey
          });
          incrementMap(questionDay, dayKey);
          incrementMap(questionMonth, monthKey);
          incrementMap(questionYear, yearKey);
        }

        if (role !== "assistant") continue;

        const sources = Array.isArray(data.sources) ? data.sources : [];
        const dedupe = new Set();
        for (const source of sources) {
          const regulation = normalizeText(source?.regulation, "unknown");
          const sourceId = normalizeText(source?.source_id, "unknown");
          const dedupeKey = `${regulation}::${sourceId}`;
          if (dedupe.has(dedupeKey)) continue;
          dedupe.add(dedupeKey);

          const eventId = hashId(`${uid}:${conversation.id}:${messageDoc.id}:${regulation}:${sourceId}`);
          regulationEvents.push({
            id: eventId,
            uid,
            conversationId: conversation.id,
            regulation,
            sourceId,
            question: lastQuestion,
            askedAt: admin.firestore.Timestamp.fromDate(timestampValue),
            dayKey,
            monthKey,
            yearKey
          });

          const regKey = makeKey(regulation);
          if (!regulationAggregate.has(regKey)) {
            regulationAggregate.set(regKey, {
              regulation,
              count: 0,
              sources: new Map()
            });
          }
          const reg = regulationAggregate.get(regKey);
          reg.count += 1;
          reg.sources.set(sourceId, (reg.sources.get(sourceId) ?? 0) + 1);
        }
      }
    }
  }

  console.log(`Processed ${usersSnapshot.size} user docs, ${conversationCount} conversations, ${messageCount} messages.`);
  console.log(`Writing ${questionEvents.length} question events and ${regulationEvents.length} regulation events...`);

  const writer = db.bulkWriter();

  for (const [key, count] of userDay) {
    writer.set(db.collection(COLLECTIONS.userDay).doc(key), { key, count, updatedAt: new Date().toISOString() });
  }
  for (const [key, count] of userMonth) {
    writer.set(db.collection(COLLECTIONS.userMonth).doc(key), { key, count, updatedAt: new Date().toISOString() });
  }
  for (const [key, count] of userYear) {
    writer.set(db.collection(COLLECTIONS.userYear).doc(key), { key, count, updatedAt: new Date().toISOString() });
  }
  for (const [key, count] of userProvider) {
    writer.set(db.collection(COLLECTIONS.userProvider).doc(makeKey(key)), { key, count, updatedAt: new Date().toISOString() });
  }

  for (const [key, count] of questionDay) {
    writer.set(db.collection(COLLECTIONS.questionDay).doc(key), { key, count, updatedAt: new Date().toISOString() });
  }
  for (const [key, count] of questionMonth) {
    writer.set(db.collection(COLLECTIONS.questionMonth).doc(key), { key, count, updatedAt: new Date().toISOString() });
  }
  for (const [key, count] of questionYear) {
    writer.set(db.collection(COLLECTIONS.questionYear).doc(key), { key, count, updatedAt: new Date().toISOString() });
  }
  for (const event of questionEvents) {
    writer.set(db.collection(COLLECTIONS.questionEvents).doc(event.id), event);
  }

  for (const event of regulationEvents) {
    writer.set(db.collection(COLLECTIONS.regulationEvents).doc(event.id), event);
  }
  for (const [regKey, aggregate] of regulationAggregate) {
    const regRef = db.collection(COLLECTIONS.regulationAggregate).doc(regKey);
    writer.set(regRef, {
      regulation: aggregate.regulation,
      regulationKey: regKey,
      count: aggregate.count,
      updatedAt: new Date().toISOString()
    });
    for (const [sourceId, count] of aggregate.sources) {
      writer.set(regRef.collection("sources").doc(makeKey(sourceId)), {
        sourceId,
        sourceKey: makeKey(sourceId),
        regulation: aggregate.regulation,
        count,
        updatedAt: new Date().toISOString()
      });
    }
  }

  await writer.close();
  console.log("Backfill complete.");
}

main().catch((error) => {
  console.error("backfill-admin-metrics failed:", error);
  process.exitCode = 1;
});
