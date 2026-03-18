/**
 * firestore-actions.ts
 *
 * All Firestore CRUD helpers. No page or component imports Firestore SDK
 * directly — they call these wrappers, which are easily mockable in tests.
 *
 * Schema:
 *   users/{uid}
 *   users/{uid}/conversations/{conversationId}
 *   users/{uid}/conversations/{conversationId}/messages/{messageId}
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  addDoc,
  type Timestamp
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "./firebase";
import type { ChatMessage, SourceExcerpt } from "./jag-chat";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  provider: string;
  createdAt: Timestamp | null;
  lastSeenAt: Timestamp | null;
}

export interface ConversationRecord {
  id: string;
  title: string;
  messageCount: number;
  createdAt: Timestamp | null;
}

export interface MessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: SourceExcerpt[];
  timestamp: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function requireDb() {
  if (!db) {
    throw new Error("Firestore is not initialized. Check your environment variables.");
  }
  return db;
}

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

/**
 * Creates or updates the user's profile document. Uses merge so that
 * existing fields (e.g. createdAt) are preserved on subsequent logins.
 */
export async function ensureUserProfile(user: User): Promise<void> {
  const firestore = requireDb();
  const ref = doc(firestore, "users", user.uid);
  const snapshot = await getDoc(ref);

  const provider =
    user.providerData[0]?.providerId ??
    (user.isAnonymous ? "anonymous" : "password");

  if (!snapshot.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      isAnonymous: user.isAnonymous,
      provider,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp()
    });
  } else {
    await setDoc(
      ref,
      { lastSeenAt: serverTimestamp(), displayName: user.displayName, email: user.email },
      { merge: true }
    );
  }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * Creates a new conversation document under the user's subtree.
 * Returns the auto-generated conversation ID.
 */
export async function createConversation(uid: string, firstMessage: string): Promise<string> {
  const firestore = requireDb();
  const title = firstMessage.trim().slice(0, 60) + (firstMessage.length > 60 ? "…" : "");
  const ref = collection(firestore, "users", uid, "conversations");
  const docRef = await addDoc(ref, {
    title,
    messageCount: 0,
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

/**
 * Fetches all conversations for a user, ordered newest first.
 */
export async function getConversations(uid: string): Promise<ConversationRecord[]> {
  const firestore = requireDb();
  const ref = collection(firestore, "users", uid, "conversations");
  const q = query(ref, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ConversationRecord, "id">)
  }));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Firestore rejects `undefined`; optional SourceExcerpt fields must be stripped. */
function sourcesForFirestore(sources: ChatMessage["sources"]): Record<string, unknown>[] {
  try {
    return JSON.parse(JSON.stringify(sources ?? [])) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/**
 * Saves a single chat message to a conversation. Also increments the
 * conversation's messageCount using a merge write — avoids a transaction
 * for a counter that is display-only.
 */
export async function saveMessage(
  uid: string,
  conversationId: string,
  message: Pick<ChatMessage, "role" | "content" | "sources">
): Promise<void> {
  const firestore = requireDb();
  const messagesRef = collection(
    firestore,
    "users",
    uid,
    "conversations",
    conversationId,
    "messages"
  );

  const content =
    typeof message.content === "string" ? message.content : String(message.content ?? "");
  const sources = sourcesForFirestore(message.sources);

  const write = async (src: Record<string, unknown>[]) => {
    await addDoc(messagesRef, {
      role: message.role,
      content,
      sources: src,
      timestamp: serverTimestamp()
    });
  };

  try {
    await write(sources);
  } catch (err) {
    if (message.role === "assistant" && sources.length > 0) {
      console.warn("[saveMessage] Assistant write failed; retrying without sources.", err);
      await write([]);
    } else {
      throw err;
    }
  }

  // Best-effort counter update — not a hard requirement.
  const convRef = doc(firestore, "users", uid, "conversations", conversationId);
  const currentCount = (await getDoc(convRef)).data()?.messageCount ?? 0;
  await setDoc(convRef, { messageCount: currentCount + 1 }, { merge: true });
}

/**
 * Fetches all messages in a conversation, ordered oldest first.
 */
export async function getMessages(
  uid: string,
  conversationId: string
): Promise<MessageRecord[]> {
  const firestore = requireDb();
  const ref = collection(
    firestore,
    "users",
    uid,
    "conversations",
    conversationId,
    "messages"
  );
  const q = query(ref, orderBy("timestamp", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      role: (data.role === "assistant" ? "assistant" : "user") as MessageRecord["role"],
      content: typeof data.content === "string" ? data.content : "",
      sources: Array.isArray(data.sources) ? data.sources : [],
      timestamp: (data.timestamp as Timestamp | null) ?? null
    };
  });
}
