export interface VapiAssistant {
  id: string;
  name: string;
}

export interface VapiCatalogLine {
  lineId: string;
  phone: string;
  group: "ai" | "office" | "cloud";
  name: string;
  phoneNumberId: string;
  inboundAssistantId?: string;
  credentialConfigured: boolean;
  status?: string;
  callable?: boolean;
}

export interface VapiCatalog {
  keyConfigured: true;
  assistants: VapiAssistant[];
  lines: VapiCatalogLine[];
  unmatchedNumbers: number;
  unavailableLineIds: string[];
  webhookConfigured: boolean;
  defaultAssistantId?: string;
  checkedAt: string;
}
