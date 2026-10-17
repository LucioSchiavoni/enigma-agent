CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_endsAt_after_startsAt" CHECK ("endsAt" > "startsAt");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlap_per_professional"
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED'));

ALTER TABLE "AvailabilityRule"
  ADD CONSTRAINT "AvailabilityRule_valid_range" CHECK (
    "dayOfWeek" BETWEEN 0 AND 6
    AND "startMinute" >= 0
    AND "endMinute" <= 1440
    AND "endMinute" > "startMinute"
  );

ALTER TABLE "AvailabilityOverride"
  ADD CONSTRAINT "AvailabilityOverride_endsAt_after_startsAt" CHECK ("endsAt" > "startsAt");

ALTER TABLE "Service"
  ADD CONSTRAINT "Service_positive_duration" CHECK ("durationMinutes" > 0 AND "bufferMinutes" >= 0);

ALTER TABLE "Business" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusinessChannel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Professional" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FaqEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_ProfessionalToService" ENABLE ROW LEVEL SECURITY;