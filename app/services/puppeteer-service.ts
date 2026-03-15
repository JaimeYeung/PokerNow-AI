import puppeteer from 'puppeteer';

import { computeTimeout, sleep } from '../helpers/bot-helper.ts';

import type { Response } from '../utils/error-handling-utils.ts';

interface GameInfo {
    game_type: string,
    big_blind: number,
    small_blind: number,
}

export class PuppeteerService {
    private default_timeout: number;
    private headless_flag: boolean;
    private use_existing_browser: boolean;
    private debugging_port: number;

    private browser!: puppeteer.Browser;
    private page!: puppeteer.Page;

    constructor(default_timeout: number, headless_flag: boolean, use_existing_browser: boolean = false, debugging_port: number = 9222) {
        this.default_timeout = default_timeout;
        this.headless_flag = headless_flag;
        this.use_existing_browser = use_existing_browser;
        this.debugging_port = debugging_port;
    }

    async init(): Promise<void> {
        if (this.use_existing_browser) {
            this.browser = await puppeteer.connect({
                browserURL: `http://localhost:${this.debugging_port}`,
                defaultViewport: null,
            });
            // Use the first available page as a placeholder; navigateToGame will find the right tab.
            const pages = await this.browser.pages();
            this.page = pages[0] ?? await this.browser.newPage();
        } else {
            this.browser = await puppeteer.launch({
                defaultViewport: null,
                headless: this.headless_flag
            });
            this.page = await this.browser.newPage();
        }
    }

    async closeBrowser(): Promise<void> {
        if (this.use_existing_browser) {
            // Don't close the user's browser – just disconnect.
            this.browser.disconnect();
        } else {
            await this.browser.close();
        }
    }
    
    async navigateToGame<D, E=Error>(game_id: string): Response<D, E> {
        if (!game_id) {
            return {
                code: "error",
                error: new Error("Game id cannot be empty.") as E
            }
        }

        const targetUrl = `https://www.pokernow.club/games/${game_id}`;
        const targetUrlAlt = `https://www.pokernow.com/games/${game_id}`;

        if (this.use_existing_browser) {
            // Find the tab already showing this game, or navigate the active tab.
            const pages = await this.browser.pages();
            const match = pages.find(p => {
                const u = p.url();
                return u.includes(game_id);
            });
            if (match) {
                this.page = match;
                await this.page.bringToFront();
            } else {
                // No matching tab – navigate the first tab to the game.
                this.page = pages[0] ?? await this.browser.newPage();
                await this.page.goto(targetUrl);
                await this.page.bringToFront();
            }
        } else {
            await this.page.goto(targetUrl);
            await this.page.setViewport({width: 1024, height: 768});
        }

        return {
            code: "success",
            data: null as D,
            msg: `Successfully opened PokerNow game with id ${game_id}.`
        }
    }
    
    async waitForGameInfo<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector('.game-infos > .blind-value-ctn > .blind-value', {timeout: this.default_timeout * 30});
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to wait for game information.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully waited for game information."
        }
    }
    
    async getGameInfo<D, E=Error>(): Response<D, E> {
        var game_info;
        try {
            game_info = await this.page.$eval(".game-infos > .blind-value-ctn > .blind-value", (div: any) => div.textContent);
        } catch (err) {
            return {
                code: "error",
                error: new Error("Could not get game info.") as E
            }
        }
        return {
            code: "success",
            data: game_info as D,
            msg: "Successfully grabbed the game info."
        }
    }
    
    convertGameInfo(game_info: string): GameInfo {
        const re = RegExp("([A-Z]+)~\\s([0-9]+)\\s\/\\s([0-9]+)");
        const matches = re.exec(game_info);
        if (matches && matches.length == 4) {
            return {game_type: matches[1], big_blind: Number(matches[3]), small_blind: Number(matches[2])};
        } else {
            throw new Error("Failed to convert game info.");
        }
    }
    
    // send enter table request as non-host player
    async sendEnterTableRequest<D, E=Error>(name: string, stack_size: number): Response<D, E> {
        if (name.length < 2 || name.length > 14) {
            return {
                code: "error",
                error: new Error("Player name must be betwen 2 and 14 characters long.") as E
            }
        }
        try {
            await this.page.waitForSelector(".table-player-seat-button", {timeout: this.default_timeout * 4});
            await this.page.$eval(".table-player-seat-button", (button: any) => button.click());
        } catch (err) {
            return {
                code: "error",
                error: new Error("Could not find open seat.") as E
            }
        }
        await this.page.waitForSelector('.selected .popover-1.request-ingress-popover', {timeout: this.default_timeout * 4});
        await this.page.focus('.selected input[placeholder="Your Name"]');
        await this.page.keyboard.type(name);
        await this.page.focus('.selected input[placeholder="Intended Stack"]');
        await this.page.keyboard.type(stack_size.toString())
        await this.page.$eval('.selected .form-1 button[type="submit"]', (button: any) => button.click());
        try {
            await this.page.waitForSelector(".alert-1-buttons > button", {timeout: this.default_timeout});
            await this.page.$eval(".alert-1-buttons > button", (button: any) => button.click());
        } catch (err) {
            var message = "Table ingress unsuccessful."
            if (await this.page.$('.selected .form-2-input-control:nth-child(1) > .error-message')) {
                message = "Player name must be unique to game.";
            }
            await this.page.$eval(".selected > .table-player-seat-button", (button: any) => button.click());
            return {
                code: "error",
                error: new Error(message) as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Table ingress request successfully sent."
        }
    }
    
    async waitForTableEntry<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".you-player", {timeout: this.default_timeout * 120});
        } catch (err) {
            return {
                code: "error",
                error: new Error("Table ingress request not accepted by host.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully entered table."
        }
    }

    /** Get the display name of the "you" player (current user in this browser). */
    async getYouPlayerName<D, E=Error>(): Response<D, E> {
        try {
            const name = await this.page.$eval(
                ".you-player .table-player-name",
                (el: any) => el?.textContent?.trim() || ""
            );
            return {
                code: "success",
                data: name as D,
                msg: "Got current player name."
            };
        } catch (err) {
            return {
                code: "error",
                error: new Error("Could not get current player name.") as E
            };
        }
    }

    /**
     * Inject AI suggestion overlay in the top-right corner of the game page.
     * Shows bright with a pulse animation when fresh. Hover reveals the reason.
     * Call dimSuggestion() after the turn ends.
     */
    async injectSuggestion(actionStr: string, betSizeInBBs: number, reason: string = "", bigBlind: number = 0): Promise<void> {
        const label = actionStr.toUpperCase();
        let sub = "";
        let chipSub = "";
        if (betSizeInBBs > 0) {
            sub = ` ${betSizeInBBs} BB`;
            if (bigBlind > 0) {
                const chips = Math.round(betSizeInBBs * bigBlind * 10) / 10;
                chipSub = ` (= ${chips} chips)`;
            }
        }
        const mainText = `🤖 ${label}${sub}`;
        const chipHint = chipSub;
        await this.page.evaluate((mainText: string, reason: string, chipHint: string) => {
            const id = "pokernow-gpt-suggestion";

            // Inject keyframe + hover styles once
            if (!document.getElementById("pokernow-gpt-style")) {
                const style = document.createElement("style");
                style.id = "pokernow-gpt-style";
                style.textContent = `
                    @keyframes pgpt-pulse {
                        0%   { box-shadow: 0 0 0 0 rgba(74,222,128,0.7); }
                        70%  { box-shadow: 0 0 0 10px rgba(74,222,128,0); }
                        100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
                    }
                    @keyframes pgpt-fadein {
                        from { opacity: 0; transform: translateY(-6px); }
                        to   { opacity: 1; transform: translateY(0); }
                    }
                    #pokernow-gpt-suggestion .pgpt-reason {
                        max-height: 0;
                        overflow: hidden;
                        opacity: 0;
                        transition: max-height 0.3s ease, opacity 0.3s ease, margin-top 0.3s ease;
                        margin-top: 0;
                    }
                    #pokernow-gpt-suggestion:hover .pgpt-reason {
                        max-height: 120px;
                        opacity: 1;
                        margin-top: 8px;
                    }
                `;
                document.head.appendChild(style);
            }

            let el = document.getElementById(id) as HTMLElement | null;
            if (!el) {
                el = document.createElement("div");
                el.id = id;
                el.style.cssText = [
                    "position: fixed",
                    "top: 16px",
                    "right: 16px",
                    "z-index: 999999",
                    "padding: 12px 16px",
                    "border-radius: 10px",
                    "font-family: system-ui, sans-serif",
                    "max-width: 280px",
                    "cursor: default",
                    "transition: opacity 0.6s ease, background 0.6s ease, border-color 0.6s ease",
                ].join(";");
                document.body.appendChild(el);
            }

            // Fresh state: bright green border + pulse animation
            el.style.background = "rgba(10,30,15,0.95)";
            el.style.border = "2px solid #4ade80";
            el.style.opacity = "1";
            el.style.animation = "pgpt-fadein 0.3s ease, pgpt-pulse 1s ease 0.3s 2";

            const reasonHtml = reason
                ? `<div class="pgpt-reason" style="font-size:12px;color:#a3e4b0;line-height:1.5;border-top:1px solid rgba(74,222,128,0.3);padding-top:8px;">${reason}</div>`
                : "";

            const chipHintHtml = chipHint
                ? `<div style="font-size:12px;color:#86efac;margin-top:2px;">${chipHint}</div>`
                : "";

            el.innerHTML = `
                <div style="font-size:11px;font-weight:500;color:#4ade80;letter-spacing:0.05em;margin-bottom:4px;">
                    ● AI Suggestion (this turn)${reason ? ' · hover for reason' : ''}
                </div>
                <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:0.02em;">
                    ${mainText}
                </div>
                ${chipHintHtml}
                ${reasonHtml}
            `;
        }, mainText, reason, chipHint);
    }

    /**
     * Dim the suggestion overlay after the player's turn ends,
     * so the user knows it's from the previous round.
     */
    async dimSuggestion(): Promise<void> {
        await this.page.evaluate(() => {
            const el = document.getElementById("pokernow-gpt-suggestion") as HTMLElement | null;
            if (!el) return;
            el.style.animation = "none";
            el.style.opacity = "0.35";
            el.style.border = "2px solid rgba(255,255,255,0.15)";
            el.style.background = "rgba(0,0,0,0.7)";
            const label = el.querySelector("div:first-child") as HTMLElement | null;
            if (label) {
                label.style.color = "#888";
                label.textContent = "○ AI Suggestion (last turn)";
            }
        });
    }
    
    // game has not started yet -> "waiting state"
    // joined when hand is currently in progress -> "in next hand"
    // if player is in waiting state, wait for next hand
    // otherwise, return
    async waitForNextHand<D, E=Error>(num_players: number, max_turn_length: number): Response<D, E> {
        // check if the player is in a waiting state
        // if not, return
        try {
            await this.page.waitForSelector([".you-player > .waiting", ".you-player > .waiting-next-hand"].join(','), {timeout: this.default_timeout});
        } catch (err) {
            return {
                code: "error",
                error: new Error("Player is not in waiting state.") as E
            }
        }
        // if player is in waiting state, wait for the waiting state to disappear
        try {
            await this.page.waitForSelector([".you-player > .waiting", ".you-player > .waiting-next-hand"].join(','), 
            {hidden: true, timeout: computeTimeout(num_players, max_turn_length, 4) * 5 + this.default_timeout});
        } catch (err) {
            return {
                code: "error",
                error: new Error("Player is not in waiting state.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Waited for next hand to start."
        }
    }
    
    async getNumPlayers<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".table-player", {timeout: this.default_timeout});
            const table_players_count = await this.page.$$eval(".table-player", (divs: any) => divs.length) as number;
            const table_player_status_count = await this.page.$$eval(".table-player-status-icon", (divs: any) => divs.length) as number;
            const num_players = table_players_count - table_player_status_count;
            return {
                code: "success",
                data: num_players as D,
                msg: `Successfully got number of players in table: ${num_players}`
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to compute number of players in table.") as E
            }
        }
    
    }
    
    // wait for bot's turn or winner of hand has been determined
    async waitForBotTurnOrWinner<D, E=Error>(num_players: number, max_turn_length: number): Response<D, E> {
        try {
            const el = await this.page.waitForSelector([".action-signal", ".table-player.winner"].join(','), {timeout: computeTimeout(num_players, max_turn_length, 4) * 5 + this.default_timeout});
            const class_name = await this.page.evaluate(el => el!.className, el);
            return {
                code: "success",
                data: class_name as D,
                msg: `Waited for ${class_name}`
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("It is not the player's turn.") as E
            }
        }
    }
    
    async waitForBotTurnEnd<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".action-signal", {hidden: true, timeout: this.default_timeout * 15});
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to wait for bot's turn to end.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully waited for bot's turn to end."
        }
    }
    
    async getPotSize<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".table > .table-pot-size > .main-value");
            const pot_size_str = await this.page.$eval(".table > .table-pot-size > .main-value", (p: any) => p.textContent);
            return {
                code: "success",
                data: pot_size_str as D,
                msg: "Successfully retrieved table pot size."
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to retrieve table pot size.") as E
            }
        }
    }
    
    async getHand<D, E=Error>(): Response<D, E> {
        try {
            const cards_div = await this.page.$$(".you-player > .table-player-cards > div");
            let cards: string[] = [];
            for (const card_div of cards_div) {
                const card_value = await card_div.$eval(".value", (span: any) => span.textContent);
                const sub_suit_letter = await card_div.$eval(".sub-suit", (span: any) => span.textContent);
                if (card_value && sub_suit_letter) {
                    cards.push(card_value + sub_suit_letter);
                } else {
                    throw "Invalid card.";
                }
            }
            return {
                code: "success",
                data: cards as D,
                msg: "Successfully retrieved player's hand."
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to retrieve player's hand.") as E
            }
        }
    }
    
    async getStackSize<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".you-player > .table-player-infos-ctn > div > .table-player-stack");
            const stack_size_str = await this.page.$eval(".you-player > .table-player-infos-ctn > div > .table-player-stack", (p: any) => p.textContent);
            return {
                code: "success",
                data: stack_size_str as D,
                msg: "Successfully retrieved bot's stack size."
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to retrieve bot's stack size.") as E
            }
        }
    }

    async waitForCallOption<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .call", {timeout: this.default_timeout});
            const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .call", (button: any) => button.disabled);
            if (is_disabled) {
                throw new Error("Call option is disabled.")
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("No option to call available.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully waited for call option."
        }
    }
    
    async call<D, E=Error>(): Response<D, E> {
        try {
            await this.page.$eval(".game-decisions-ctn > .action-buttons > .call", (button: any) => button.click());
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to execute call action.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully executed call action."
        }
    }
    
    async waitForFoldOption<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .fold", {timeout: this.default_timeout});
            const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .fold", (button: any) => button.disabled);
            if (is_disabled) {
                throw new Error("Fold option is disabled.")
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("No option to fold available.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully waited for fold option."
        }
    }

    async fold<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .fold", {timeout: this.default_timeout});
            await this.page.$eval(".game-decisions-ctn > .action-buttons > .fold", (button: any) => button.click());
        } catch (err) {
            return {
                code: "error",
                error: new Error("No option to fold available.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully executed fold action."
        }
    }
    
    async cancelUnnecessaryFold<D, E=Error>(): Response<D, E> {
        const fold_alert_text = "Are you sure that you want do an unnecessary fold?Do not show this again in this session? "
        try {
            await this.page.waitForSelector(".alert-1", {timeout: this.default_timeout});
            const text = await this.page.$eval(".alert-1 > .content", (div: any) => div.textContent);
            if (text === fold_alert_text) {
                await this.page.$eval(".alert-1 > .alert-1-buttons > .button-1.red", (button: any) => button.click());
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("No option to cancel unnecessary fold available.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully cancelled unnecessary fold."
        }
    }
    
    async waitForCheckOption<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .check", {timeout: this.default_timeout});
            const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .check", (button: any) => button.disabled);
            if (is_disabled) {
                throw new Error("Check option is disabled.")
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("No option to check available.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully waited for check option."
        }
    }
    
    async check<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .check", {timeout: this.default_timeout});
            await this.page.$eval(".game-decisions-ctn > .action-buttons > .check", (button: any) => button.click());
        } catch (err) {
            return {
                code: "error",
                error: new Error("No option to check available.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully executed check action."
        }
    }
    
    async waitForBetOption<D, E=Error>(): Response<D ,E> {
        try {
            await this.page.waitForSelector(".game-decisions-ctn > .action-buttons > .raise", {timeout: this.default_timeout});
            const is_disabled = await this.page.$eval(".game-decisions-ctn > .action-buttons > .raise", (button: any) => button.disabled);
            if (is_disabled) {
                throw new Error("Bet or raise option is disabled.")
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("No option to bet or raise available.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Successfully waited for bet or raise option."
        }
    }
    
    async betOrRaise<D, E=Error>(bet_amount: number): Response<D, E> {
        try {
            const bet_action = await this.page.$eval(".game-decisions-ctn > .action-buttons > .raise", (button: any) => button.textContent);
            await this.page.$eval(".game-decisions-ctn > .action-buttons > .raise", (button: any) => button.click());
    
            if (bet_action === "Raise") {
                const res = await this.getCurrentBet();
                if (res.code === "success") {
                    const current_bet = res.data as number;
                    bet_amount += current_bet;
                }
            }
            await this.page.waitForSelector(".game-decisions-ctn > form > .raise-bet-value > div > input", {timeout: this.default_timeout});
            await this.page.focus(".game-decisions-ctn > form > .raise-bet-value > div > input");
            await sleep(this.default_timeout);
            await this.page.keyboard.type(bet_amount.toString(), {delay: 200});
            await this.page.waitForSelector(".game-decisions-ctn > form > .action-buttons > .bet", {timeout: this.default_timeout});
            await this.page.$eval(".game-decisions-ctn > form > .action-buttons > .bet", (input: any) => input.click());
        } catch (err) {
            return {
                code: "error",
                error: new Error(`Failed to bet with amount ${bet_amount}.`) as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: `Successfully executed bet action with amount ${bet_amount}.`
        }
    }

    async getCurrentBet<D, E=Error>(): Response<D, E> {
        try {
            const el = await this.page.waitForSelector(".you-player > .table-player-bet-value", {timeout: this.default_timeout});
            const current_bet = await this.page.evaluate((el: any) => isNaN(el.textContent) ? '0' : el.textContent, el);
            return {
                code: "success",
                data: parseFloat(current_bet) as D,
                msg: `Successfully retrieved current bet amount: ${current_bet}`
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error("No existing bet amount found.") as E
            }
        }
    }

    async waitForHandEnd<D, E=Error>(): Response<D, E> {
        try {
            await this.page.waitForSelector(".table-player.winner", {hidden: true, timeout: this.default_timeout * 10});
        } catch (err) {
            return {
                code: "error",
                error: new Error("Failed to wait for hand to finish.") as E
            }
        }
        return {
            code: "success",
            data: null as D,
            msg: "Waited for hand to finish."
        }
    }
}
