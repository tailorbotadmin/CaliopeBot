import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc,
  updateDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

import { db } from './firebase';

export type Role = 'SuperAdmin' | 'Admin' | 'Responsable_Editorial' | 'Editor' | 'Autor' | 'Traductor';

// Firestore timestamps come back as Timestamp on read, but we write with serverTimestamp() (FieldValue).
// We use Timestamp here for strict read typing; write operations are safe since setDoc/updateDoc accept both.
type FirestoreDate = Timestamp;


export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  role: Role;
  organizationId?: string; // Null if SuperAdmin
  createdAt: FirestoreDate;
}

export interface Organization {
  id: string;
  name: string;
  createdAt: FirestoreDate;
}

export interface Book {
  id: string;
  title: string;
  authorId: string;
  organizationId: string;
  status: 'draft' | 'processing' | 'review_editor' | 'review_author' | 'review_responsable' | 'approved' | 'error';
  fileUrl?: string;
  fileName?: string;
  errorMessage?: string;
  createdAt: FirestoreDate;
}

export async function updateBookStatus(orgId: string, bookId: string, status: string, errorMessage?: string) {
  const bookRef = doc(db, 'organizations', orgId, 'books', bookId);
  const update: Record<string, unknown> = { status };
  if (errorMessage !== undefined) update.errorMessage = errorMessage;
  await updateDoc(bookRef, update);
}

// ==========================================
// USER PROFILES
// ==========================================

export async function createUserProfile(uid: string, data: Omit<UserProfile, 'uid' | 'createdAt'>) {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, {
    ...data,
    createdAt: serverTimestamp()
  });
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    return { uid: snap.id, ...snap.data() } as UserProfile;
  }
  return null;
}

export async function getOrgUsers(orgId: string): Promise<UserProfile[]> {
  const q = query(collection(db, 'users'), where('organizationId', '==', orgId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
}

export async function updateUserRole(uid: string, role: Role) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { role });
}


// ==========================================
// ORGANIZATIONS
// ==========================================

export async function createOrganization(name: string): Promise<string> {
  const orgRef = await addDoc(collection(db, 'organizations'), {
    name,
    createdAt: serverTimestamp()
  });
  return orgRef.id;
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const docRef = doc(db, 'organizations', orgId);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return { id: snap.id, ...snap.data() } as Organization;
  }
  return null;
}

export async function getOrganizations(): Promise<Organization[]> {
  const q = query(collection(db, 'organizations'));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Organization));
}

// ==========================================
// BOOKS
// ==========================================

export async function createBook(orgId: string, authorId: string, title: string, fileUrl?: string, fileName?: string): Promise<string> {
  const bookRef = await addDoc(collection(db, 'organizations', orgId, 'books'), {
    title,
    authorId,
    organizationId: orgId,
    // Always start as 'draft'. The AI worker sets 'processing' once it
    // confirms it received the ingestion request successfully.
    status: 'draft',
    fileUrl: fileUrl || null,
    fileName: fileName || null,
    createdAt: serverTimestamp()
  });
  return bookRef.id;
}

export async function getBooksByOrganization(orgId: string): Promise<Book[]> {
  const snap = await getDocs(collection(db, 'organizations', orgId, 'books'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Book));
}

export async function getBooksByAuthor(orgId: string, authorId: string): Promise<Book[]> {
  const q = query(
    collection(db, 'organizations', orgId, 'books'),
    where('authorId', '==', authorId)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Book));
}

// ==========================================
// AI TRAINING
// ==========================================

export interface TrainingItem {
  id?: string;
  original: string;
  aiSuggestion: string;
  rule: string;
  status: "pending" | "approved" | "rejected";
  organizationId: string;
  bookId?: string;
  createdAt?: FirestoreDate;
}

export async function getTrainingItemsByOrganization(orgId: string): Promise<TrainingItem[]> {
  const q = query(collection(db, 'training_samples'), where("organizationId", "==", orgId));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as TrainingItem));
}

export async function updateTrainingItemStatus(itemId: string, status: "pending" | "approved" | "rejected") {
  const itemRef = doc(db, 'training_samples', itemId);
  await updateDoc(itemRef, { status });
}

// ==========================================
// CORRECTIONS / KPIs
// ==========================================

export interface CorrectionRecord {
  id: string;
  bookId: string;
  organizationId: string;
  editorId?: string;
  editorEmail?: string;
  editorName?: string;
  status: 'accepted' | 'rejected' | 'pending';
  sourceRule?: string;
  createdAt: FirestoreDate;
  reviewedAt?: FirestoreDate;
}

export async function getOrgCorrections(orgId: string): Promise<CorrectionRecord[]> {
  const q = query(collection(db, 'corrections'), where('organizationId', '==', orgId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as CorrectionRecord));
}

export interface EditorKPI {
  editorId: string;
  editorName: string;
  editorEmail: string;
  totalReviewed: number;
  accepted: number;
  rejected: number;
  acceptRate: number;
  topRule: string;
}

export interface OrgKPIs {
  totalCorrections: number;
  totalAccepted: number;
  totalRejected: number;
  globalAcceptRate: number;
  topRule: string;
  activeEditors: number;
  editors: EditorKPI[];
}

export async function computeOrgKPIs(orgId: string): Promise<OrgKPIs> {
  const corrections = await getOrgCorrections(orgId);

  const reviewed = corrections.filter(c => c.status !== 'pending');
  const accepted = reviewed.filter(c => c.status === 'accepted');

  // Per-editor aggregation
  const editorMap = new Map<string, {
    name: string; email: string; total: number; accepted: number; rules: Record<string, number>;
  }>();

  for (const c of reviewed) {
    const eid = c.editorId ?? 'unknown';
    if (!editorMap.has(eid)) {
      editorMap.set(eid, { name: c.editorName ?? eid, email: c.editorEmail ?? '', total: 0, accepted: 0, rules: {} });
    }
    const entry = editorMap.get(eid)!;
    entry.total++;
    if (c.status === 'accepted') entry.accepted++;
    if (c.sourceRule) entry.rules[c.sourceRule] = (entry.rules[c.sourceRule] ?? 0) + 1;
  }

  const editors: EditorKPI[] = [...editorMap.entries()].map(([eid, e]) => ({
    editorId: eid,
    editorName: e.name,
    editorEmail: e.email,
    totalReviewed: e.total,
    accepted: e.accepted,
    rejected: e.total - e.accepted,
    acceptRate: e.total > 0 ? Math.round((e.accepted / e.total) * 100) : 0,
    topRule: Object.entries(e.rules).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
  })).sort((a, b) => b.totalReviewed - a.totalReviewed);

  // Global top rule  
  const globalRules: Record<string, number> = {};
  for (const c of reviewed) {
    if (c.sourceRule) globalRules[c.sourceRule] = (globalRules[c.sourceRule] ?? 0) + 1;
  }
  const topRule = Object.entries(globalRules).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

  return {
    totalCorrections: reviewed.length,
    totalAccepted: accepted.length,
    totalRejected: reviewed.length - accepted.length,
    globalAcceptRate: reviewed.length > 0 ? Math.round((accepted.length / reviewed.length) * 100) : 0,
    topRule: topRule.startsWith('RAE:') ? topRule.replace('RAE:', '') : topRule,
    activeEditors: editorMap.size,
    editors,
  };
}
