import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "./firebase";

import {
  POSSIBLE_REQUISITIONERS,
  REQUISITIONER_CONTACTS,
  type RequisitionerDirectoryContact,
} from "./requisitioner-directory-data";

export type RequisitionerContact = RequisitionerDirectoryContact & {
  department?: string;
  source?: "Requisitioner Details" | "manual";
};

export const CONTACTS = "requisitionerDirectory";

export { POSSIBLE_REQUISITIONERS, REQUISITIONER_CONTACTS };

export function normalizeRequisitionerName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export const normalizePerson = normalizeRequisitionerName;

export function getRequisitionerContacts(): RequisitionerContact[] {
  return REQUISITIONER_CONTACTS.map((item) => ({
    ...item,
    source: "Requisitioner Details" as const,
  }));
}

export const getPossibleRequisitioners = getRequisitionerContacts;

export function findRequisitionerContacts(
  name: string,
): RequisitionerContact[] {
  const key = normalizeRequisitionerName(name);

  if (!key) return [];

  return getRequisitionerContacts().filter(
    (item) => normalizeRequisitionerName(item.name) === key,
  );
}

export function findRequisitionerContact(
  name: string,
): RequisitionerContact | undefined {
  return findRequisitionerContacts(name)[0];
}

function requireFirestore() {
  if (!db) {
    throw new Error(
      "Firebase is not configured. Add your NEXT_PUBLIC_FIREBASE_* variables.",
    );
  }

  return db;
}

export function subscribeRequisitionerContacts(
  callback: (items: RequisitionerContact[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!db) {
    callback(getRequisitionerContacts());

    onError?.(
      new Error(
        "Firebase is not configured. Showing the built-in requisitioner directory only.",
      ),
    );

    return () => { };
  }

  // IMPORTANT:
  // Use the narrowed local variable instead of `db` directly.
  const firestore = db;

  return onSnapshot(
    collection(firestore, CONTACTS),
    (snapshot) => {
      const map = new Map<string, RequisitionerContact>();

      // Built-in directory
      getRequisitionerContacts().forEach((item) => {
        map.set(normalizeRequisitionerName(item.name), item);
      });

      // Firestore manual overrides / additions
      snapshot.docs.forEach((snap) => {
        const data = snap.data() as Partial<RequisitionerContact>;

        const name = String(data.name || "").trim();
        const email = String(data.email || "").trim();

        if (!name || !email) return;

        const key = normalizeRequisitionerName(name);

        map.set(key, {
          name,
          email,
          department: String(data.department || ""),
          source: "manual",
        });
      });

      callback(
        Array.from(map.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
    },
    (error) => onError?.(error),
  );
}

export async function upsertRequisitionerContactCloud(input: {
  name: string;
  email: string;
  department?: string;
}) {
  const firestore = requireFirestore();

  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();

  if (!cleanName) {
    throw new Error("Requisitioner name is required.");
  }

  if (!cleanEmail.includes("@")) {
    throw new Error("Enter a valid requisitioner email.");
  }

  const id =
    normalizeRequisitionerName(cleanName)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || `requisitioner-${Date.now()}`;

  await setDoc(
    doc(firestore, CONTACTS, id),
    {
      name: cleanName,
      email: cleanEmail,
      department: input.department || "",
      source: "manual",
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function seedRequisitionerDirectory() {
  // IMPORTANT:
  // This is the validated Firestore instance.
  const firestore = requireFirestore();

  for (let start = 0; start < REQUISITIONER_CONTACTS.length; start += 400) {
    const batch = writeBatch(firestore);

    const chunk = REQUISITIONER_CONTACTS.slice(start, start + 400);

    chunk.forEach((contact) => {
      const id =
        normalizeRequisitionerName(contact.name)
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 120) || `requisitioner-${start}`;

      // FIX:
      // Before:
      // doc(db, CONTACTS, id)
      //
      // Correct:
      // doc(firestore, CONTACTS, id)

      batch.set(
        doc(firestore, CONTACTS, id),
        {
          name: contact.name,
          email: contact.email,
          source: "Requisitioner Details",
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });

    await batch.commit();
  }

  return {
    ok: true,
    count: REQUISITIONER_CONTACTS.length,
  };
}

export const saveRequisitionerContacts = seedRequisitionerDirectory;

export const getRequisitionerDirectory = getRequisitionerContacts;