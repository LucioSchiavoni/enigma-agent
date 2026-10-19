import { Prisma } from '../generated/prisma/client';

export type ReferenceTarget =
  | 'Location'
  | 'BusinessChannel'
  | 'Service'
  | 'Professional'
  | 'Contact'
  | 'Conversation'
  | 'CalendarConnection';

export interface ForeignKey {
  scalar: string;
  relation: string;
  target: ReferenceTarget;
}

export const scalarFields: Record<Prisma.ModelName, ReadonlySet<string>> = {
  Business: new Set(Object.values(Prisma.BusinessScalarFieldEnum)),
  Location: new Set(Object.values(Prisma.LocationScalarFieldEnum)),
  BusinessChannel: new Set(Object.values(Prisma.BusinessChannelScalarFieldEnum)),
  Service: new Set(Object.values(Prisma.ServiceScalarFieldEnum)),
  Professional: new Set(Object.values(Prisma.ProfessionalScalarFieldEnum)),
  AvailabilityRule: new Set(Object.values(Prisma.AvailabilityRuleScalarFieldEnum)),
  AvailabilityOverride: new Set(Object.values(Prisma.AvailabilityOverrideScalarFieldEnum)),
  CalendarConnection: new Set(Object.values(Prisma.CalendarConnectionScalarFieldEnum)),
  FaqEntry: new Set(Object.values(Prisma.FaqEntryScalarFieldEnum)),
  Contact: new Set(Object.values(Prisma.ContactScalarFieldEnum)),
  ContactIdentity: new Set(Object.values(Prisma.ContactIdentityScalarFieldEnum)),
  Conversation: new Set(Object.values(Prisma.ConversationScalarFieldEnum)),
  Message: new Set(Object.values(Prisma.MessageScalarFieldEnum)),
  Appointment: new Set(Object.values(Prisma.AppointmentScalarFieldEnum)),
  AgentUsage: new Set(Object.values(Prisma.AgentUsageScalarFieldEnum)),
  KnowledgeSection: new Set(Object.values(Prisma.KnowledgeSectionScalarFieldEnum)),
};

export const foreignKeys: Record<Prisma.ModelName, readonly ForeignKey[]> = {
  Business: [],
  AgentUsage: [],
  KnowledgeSection: [],
  Location: [],
  BusinessChannel: [{ scalar: 'locationId', relation: 'location', target: 'Location' }],
  Service: [],
  Professional: [],
  AvailabilityRule: [
    { scalar: 'professionalId', relation: 'professional', target: 'Professional' },
    { scalar: 'locationId', relation: 'location', target: 'Location' },
  ],
  AvailabilityOverride: [{ scalar: 'professionalId', relation: 'professional', target: 'Professional' }],
  CalendarConnection: [{ scalar: 'professionalId', relation: 'professional', target: 'Professional' }],
  FaqEntry: [],
  Contact: [],
  ContactIdentity: [{ scalar: 'contactId', relation: 'contact', target: 'Contact' }],
  Conversation: [
    { scalar: 'contactId', relation: 'contact', target: 'Contact' },
    { scalar: 'businessChannelId', relation: 'businessChannel', target: 'BusinessChannel' },
  ],
  Message: [{ scalar: 'conversationId', relation: 'conversation', target: 'Conversation' }],
  Appointment: [
    { scalar: 'contactId', relation: 'contact', target: 'Contact' },
    { scalar: 'serviceId', relation: 'service', target: 'Service' },
    { scalar: 'professionalId', relation: 'professional', target: 'Professional' },
    { scalar: 'locationId', relation: 'location', target: 'Location' },
    { scalar: 'calendarConnectionId', relation: 'calendarConnection', target: 'CalendarConnection' },
  ],
};
