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

/**
 * Multi-payer group expense («چندپرداخت‌کننده», the Splitwise / Settle Up
 * model): ONE form where each participant says how much THEY paid; the
 * total is the sum, split equally among all participants. The server
 * stores it as one expense per payer (the Tricount model, automated) in a
 * single transaction, so the existing share/balance model is untouched —
 * and returns the minimum-transaction settlement plan for the trip.
 */
export class GroupParticipantDto {
  /** Set when the participant is a registered user (Phase 1: only yourself). */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Set when the participant is one of the creator's contacts. */
  @IsOptional()
  @IsUUID()
  contactId?: string;
}

export class GroupPayerDto {
  /** Set when the payer is a registered user (Phase 1: only yourself). */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /** Set when the payer is one of the creator's contacts. */
  @IsOptional()
  @IsUUID()
  contactId?: string;

  /** How much this payer paid, in Tomans. */
  @IsInt()
  @Min(1)
  amount!: number;
}

export class CreateGroupExpenseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  /** The trip members. At least two. */
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => GroupParticipantDto)
  participants!: GroupParticipantDto[];

  /** Who paid what. At least two payers; every payer must be a participant. */
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => GroupPayerDto)
  payers!: GroupPayerDto[];
}
