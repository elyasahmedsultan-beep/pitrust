type PiPaymentState = {
  status?: {
    transaction_verified?: boolean;
    developer_completed?: boolean;
  };
  transaction?: {
    verified?: boolean;
  };
};

export function hasVerifiedPiTransaction(payment: PiPaymentState): boolean {
  return payment.status?.transaction_verified === true ||
    payment.transaction?.verified === true;
}

export function canCancelPiPayment(payment: PiPaymentState): boolean {
  const explicitlyUnverified = payment.status?.transaction_verified === false ||
    payment.transaction?.verified === false;
  return explicitlyUnverified &&
    !hasVerifiedPiTransaction(payment) &&
    payment.status?.developer_completed !== true;
}