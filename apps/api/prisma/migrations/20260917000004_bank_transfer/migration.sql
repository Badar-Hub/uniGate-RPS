-- Bank transfer (IBFT) as a first-class payment method (payments.md §Bank transfer).
--   * documents can target a payment (the payer's receipt) — one more owner FK under the
--     single-owner check;
--   * payments record what the payer declared and who verified it.

ALTER TYPE "document_applies_to" ADD VALUE IF NOT EXISTS 'PAYMENT';

ALTER TABLE "documents" ADD COLUMN "payment_id" UUID;
ALTER TABLE "documents" ADD CONSTRAINT "documents_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "documents_payment_id_idx" ON "documents"("payment_id");

ALTER TABLE documents DROP CONSTRAINT IF EXISTS ck_documents_single_owner;
ALTER TABLE documents ADD CONSTRAINT ck_documents_single_owner CHECK (
  num_nonnulls(user_id, owner_profile_id, driver_profile_id, vehicle_id,
               corporate_customer_profile_id, expense_id, maintenance_record_id, trip_proof_id, payment_id) = 1
);

ALTER TABLE "payments"
  ADD COLUMN "transfer_reference" VARCHAR(64),
  ADD COLUMN "transferred_at" TIMESTAMPTZ,
  ADD COLUMN "receipt_document_id" UUID,
  ADD COLUMN "receipt_submitted_at" TIMESTAMPTZ,
  ADD COLUMN "verified_by_user_id" UUID,
  ADD COLUMN "verified_at" TIMESTAMPTZ,
  ADD COLUMN "verification_notes" TEXT;

-- The finance queue: bank transfers awaiting verification.
CREATE INDEX "payments_bank_transfer_queue_idx" ON "payments"("status", "receipt_submitted_at")
  WHERE provider_code = 'bank_transfer' AND status = 'PENDING';
