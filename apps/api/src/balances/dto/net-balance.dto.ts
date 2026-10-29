import { IsString, Matches } from 'class-validator';

export class NetBalanceDto {
  /**
   * Counterparty key exactly as returned by GET /balances:
   * "user:<id>" for a registered user (linked contacts resolve to their
   * user) or "contact:<id>" for an unlinked virtual contact.
   */
  @IsString()
  @Matches(/^(user|contact):[A-Za-z0-9-]+$/, {
    message: 'partyKey must be a counterparty key from GET /balances',
  })
  partyKey!: string;
}
