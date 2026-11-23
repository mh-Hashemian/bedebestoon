import { ArrayMinSize, IsArray, IsString, Matches } from 'class-validator';

export class SettlePlanDto {
  /**
   * Counterparty keys to settle with, exactly as returned by GET /balances
   * ("user:<id>" for a registered user, "contact:<id>" for an unlinked
   * virtual contact). The current user is always included automatically.
   */
  @IsArray()
  @ArrayMinSize(1, {
    message: 'Select at least one other person to settle with',
  })
  @IsString({ each: true })
  @Matches(/^(user|contact):[A-Za-z0-9-]+$/, {
    each: true,
    message: 'partyKey must be a counterparty key from GET /balances',
  })
  partyKeys!: string[];
}
