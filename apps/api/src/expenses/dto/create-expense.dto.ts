import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ParticipantDto {
  /** Set when the participant is a registered user (Phase 1: only yourself). */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Set when the participant is one of the creator's contacts. */
  @IsOptional()
  @IsUUID()
  contactId?: string;

  /**
   * Custom split amount for this participant. Either ALL participants carry
   * an amount (custom split, must sum to totalAmount) or NONE do (equal
   * split with the v1.1 remainder rule).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;
}

export class CreateExpenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsInt()
  @Min(1)
  totalAmount!: number; // Tomans

  /**
   * Addendum v1.1: when set, the payer is this (virtual) contact instead of
   * the current user — e.g. "Sajad paid for lunch" before Sajad has joined.
   * Must be one of the creator's own contacts.
   */
  @IsOptional()
  @IsUUID()
  payerContactId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants!: ParticipantDto[];
}
