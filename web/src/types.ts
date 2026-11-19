export type Role = 'admin' | 'broker' | 'asistan' | 'danisman';
export type PbxNumber = { did: string; type: 'personal' | 'listing' | 'hunt'; label: string; user_id: number | null; user_name?: string | null; trunk?: string | null };

export type User = {
  id: number; name: string; title: string; role: Role; email: string; phone: string;
  forward_phone: string | null; extension: string | null; department: string | null;
  voice_announcement: number; recording_broker: number; recording_assistant: number;
  work_start: string; work_end: string;
  saturday_enabled: number; saturday_start: string; saturday_end: string;
  sunday_enabled: number; sunday_start: string; sunday_end: string;
  numbers?: PbxNumber[];
  specialties?: string | null;
  status?: 'active' | 'pending';
};

export type OfficeSettings = { office_start: string; office_end: string; office_days: string };

export type Contact = { id: number; name: string; phone: string; type: 'ALICI' | 'SATICI'; created_at: string; note: string | null };

export type CallStatus = 'initiated' | 'ringing' | 'answered' | 'completed' | 'missed' | 'failed';
export type Call = {
  id: number; direction: 'inbound' | 'outbound'; customer_phone: string;
  dialed_number: string | null; dialed_label: string | null; status: CallStatus;
  duration_sec: number; recording_ref: string | null; started_at: string;
  contact_id: number | null; contact_name: string | null; contact_type: Contact['type'] | null; user_name: string | null;
  listing_ref?: string | null; listing_title?: string | null;
};

export type Appointment = {
  id: number; user_id: number; contact_id: number | null; name: string; phone: string;
  due_at: string; remind_before: number; note: string | null; status: 'open' | 'done' | 'cancelled'; created_at: string;
};

export type Listing = {
  id: number; ref: string; title: string; category: 'konut' | 'ticari' | 'arazi'; district: string | null;
  price: number | null; url: string | null; user_id: number | null; user_name: string | null; active: number; created_at: string;
};
