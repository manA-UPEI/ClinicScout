/**
 * The message body for "report incorrect information" — the same shape
 * `draftAppointmentEmail.ts` uses for its draft, pure and easy to verify
 * against a fixture without touching the DOM or a mail client.
 */
export interface ClinicIssueReport {
  subject: string;
  body: string;
}

export function draft_clinic_issue_report(
  clinic_name: string,
  source_url: string
): ClinicIssueReport {
  return {
    subject: `Incorrect listing: ${clinic_name}`,
    body:
      `I found something wrong with this listing:\n\n` +
      `${clinic_name}\n${source_url}\n\n` +
      `What's wrong:\n`,
  };
}
