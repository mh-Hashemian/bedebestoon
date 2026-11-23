import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

/**
 * Settle one transfer of a settlement plan: the debtor (fromKey) pays the
 * creditor (toKey) `amount`. Scoped to the given expenses (the sub-expenses
 * of one group expense), so a group settlement never touches older debts.
 * The debtor's open shares to the creditor in those expenses are marked
 * settled, splitting a share when only part of it is covered — the same
 * split the «کم و وجه» netting uses.
 */
export class SettleTransferDto {
  /** Debtor — pays this amount. "user:<id>" or "contact:<id>". */
  @IsString()
  @Matches(/^(user|contact):[A-Za-z0-9-]+$/, {
    message: 'fromKey must be a party key ("user:<id>" or "contact:<id>")',
  })
  fromKey!: string;

  /** Creditor — receives this amount. "user:<id>" or "contact:<id>". */
  @IsString()
  @Matches(/^(user|contact):[A-Za-z0-9-]+$/, {
    message: 'toKey must be a party key ("user:<id>" or "contact:<id>")',
  })
  toKey!: string;

  /** Amount in Tomans to settle. */
  @IsInt()
  @Min(1)
  amount!: number;

  /** The expenses the transfer belongs to (one group expense's sub-expenses). */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  expenseIds!: string[];
}
