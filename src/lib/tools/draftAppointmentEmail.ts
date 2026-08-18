import type { DraftedEmail } from "../../domain/entities/agentRun.ts";

export function draft_appointment_email(
  clinic_name: string,
  desired_time: string,
  user_context: string
): DraftedEmail {
  return {
    subject_line: `Appointment Request - ${clinic_name}`,
    email_body:
      `Hello ${clinic_name} team,\n\n` +
      `I would like to request an appointment${desired_time ? ` around ${desired_time}` : ""}. ` +
      `${user_context}\n\n` +
      `Could you please confirm availability and next steps?\n\n` +
      `Thank you,\n[Your Name]`,
  };
}
