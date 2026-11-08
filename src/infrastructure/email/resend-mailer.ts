import { Resend } from "resend";
import type { Mailer } from "@/modules/shared/ports";

type Message = Parameters<Mailer["send"]>[0];
type ResendLike = { emails: { send(payload: { from: string; to: string[]; subject: string; html: string; text: string }): Promise<{ error: { message: string } | null }> } };

export class ResendMailer implements Mailer {
  private readonly client: ResendLike;

  constructor(
    private readonly options: { apiKey: string; from: string },
    client?: ResendLike,
  ) {
    this.client = client ?? (new Resend(options.apiKey) as unknown as ResendLike);
  }

  async send(message: Message): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.options.from, ...message });
    if (error) throw new Error(`Resend: ${error.message}`);
  }
}

/** Dev fallback when RESEND_API_KEY is not set. */
export class ConsoleMailer implements Mailer {
  async send(message: Message): Promise<void> {
    console.info(`[mail] to=${message.to.join(",")} subject=${JSON.stringify(message.subject)}\n${message.text}`);
  }
}
