import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SharePhoneDto {
  /**
   * The current user's own phone number. In production this value MUST come
   * from Telegram's native contact-share (the bot receives the contact update
   * and Telegram guarantees contact.user_id == sender), never from free-text
   * input — see PhoneLinkService and BUILD_LOG Phase 3 hardening notes.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  phone!: string;
}
