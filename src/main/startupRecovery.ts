export interface StaleEmailReservationRepository {
  clearStaleReservations(): number;
}

export function recoverStaleEmailReservations(
  repository: StaleEmailReservationRepository,
  report: (message: string) => void
): number {
  const released = repository.clearStaleReservations();
  if (released > 0) {
    report(
      '[MAIN_RECOVERY] Released ' + released + ' stale email reservations.'
    );
  }
  return released;
}
