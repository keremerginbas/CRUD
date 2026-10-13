export type ConversationKind = "call" | "whatsapp";

export type ConversationAnalysisStatus =
  | "pending"
  | "completed"
  | "missing_transcript"
  | "missing_api_key"
  | "invalid_provider"
  | "missing_source"
  | "superseded";

/** Strict, display-safe output returned by the analysis provider. */
export interface ConversationAnalysis {
  summary: string;
  customerIntent: string;
  outcome: string;
  nextSteps: string;
  confidence: string;
  dataLimits: string[];
}

/** Durable event payload: IDs and a fingerprint only, never transcript/message text or secrets. */
export interface ConversationAnalysisEventPayload {
  type: "conversation-analysis";
  kind: ConversationKind;
  sourceId: string;
  fingerprint: string;
  sourceLeadId?: string;
  requestedAt: string;
}

export interface ConversationAnalysisMetadata {
  id: string;
  type: "conversation-analysis";
  kind: ConversationKind;
  sourceKind: ConversationKind;
  sourceId: string;
  sourceLeadId?: string;
  contactId?: string;
  fingerprint: string;
  eventId?: string;
  status: ConversationAnalysisStatus;
  analysis?: ConversationAnalysis;
  feedId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** Feed extension consumed by the CRM feed without changing ordinary FeedPost records. */
export interface ConversationAnalysisFeedPost {
  id: string;
  author: "XRE Asistan";
  text: string;
  leadId: string;
  contactId: string;
  kind: "ai-analysis";
  sourceKind: ConversationKind;
  sourceId: string;
  analysis: ConversationAnalysis;
  likes: string[];
  comments: [];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationAnalysisResult {
  status: ConversationAnalysisStatus;
  eventId: string;
  sourceKind: ConversationKind;
  sourceId: string;
  fingerprint: string;
  feedId?: string;
  metadataId?: string;
  queuedEventId?: string;
  dataLimits?: string[];
}

export interface ConversationAnalysisAnnotation
  extends ConversationAnalysisMetadata {
  /** The safe persisted shape is intentionally repeated for API consumers. */
  analysis?: ConversationAnalysis;
}
