import type { PiPayment } from "./pi-sdk";

export type IncompletePiPaymentAction = "complete" | "cancel" | "manual_reconciliation";

export function incompletePiPaymentAction(
  payment: PiPayment,
  supportsAutomaticCancellation: boolean,
): IncompletePiPaymentAction {
  const txid = payment.transaction?.txid?.trim();
  const walletVerified =
    payment.status?.transaction_verified === true ||
    payment.transaction?.verified === true;
  const walletUnverified =
    payment.status?.transaction_verified === false ||
    payment.transaction?.verified === false;

  if (walletVerified) return txid ? "complete" : "manual_reconciliation";
  if (payment.status?.developer_completed) return "manual_reconciliation";
  return walletUnverified && supportsAutomaticCancellation
    ? "cancel"
    : "manual_reconciliation";
}