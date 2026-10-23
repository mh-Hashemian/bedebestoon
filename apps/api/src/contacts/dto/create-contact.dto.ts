import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  /**
   * Optional at creation, but REQUIRED for Addendum v1.1 auto-linking:
   * a contact without a phone can never be matched to a real user.
   * Any common Iranian format is accepted; stored normalized (+98...).
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
