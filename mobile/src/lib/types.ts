export type Role = 'admin' | 'broker' | 'asistan' | 'danisman';

export type PbxNumber = { did: string; type: 'personal' | 'listing' | 'hunt'; label: string };

export type User = {
  id: number;
  name: string;
  title: string;
  role: Role;
  email: string;
  phone: string;
  forward_phone: string | null;
  extension: string | null;
  voice_announcement: number;
  recording_broker: number;
  recording_assistant: number;
  work_start: string;
  work_end: string;
  saturday_enabled: number;
  saturday_start: string;
  saturday_end: string;
  sunday_enabled: number;
  sunday_start: string;
  sunday_end: string;
  numbers?: PbxNumber[];
};

export type Contact = { id: number; name: string; phone: string; type: 'ALICI' | 'SATICI'; created_at: string; note: string | null };

export type Call = {
  id: number;
  direction: 'inbound' | 'outbound';
  customer_phone: string;
  dialed_number: string | null;
  dialed_label: string | null;
  status: 'initiated' | 'ringing' | 'answered' | 'completed' | 'missed' | 'failed';
  duration_sec: number;
  recording_ref: string | null;
  started_at: string;
  contact_id: number | null;
  contact_name: string | null;
  contact_type: Contact['type'] | null;
  user_name: string | null;
};
