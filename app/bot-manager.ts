import dotenv from 'dotenv';
import prompt from 'prompt-sync';

import { Bot } from './bot.ts'

import ai_config_json from './configs/ai-config.json' with { type: "json" };
import bot_config_json from './configs/bot-config.json' with { type: "json" };
import webdriver_config_json from './configs/webdriver-config.json' with { type: "json" };

import { DBService } from './services/db-service.ts';
import { LogService } from './services/log-service.ts';
import { PlayerService } from './services/player-service.ts';
import { PuppeteerService } from './services/puppeteer-service.ts';

import { AIConfig, BotConfig, WebDriverConfig } from './interfaces/config-interfaces.ts';
import { AIServiceFactory } from './helpers/ai-service-factory.ts';

const io = prompt();
const ai_config: AIConfig = ai_config_json;
const bot_config: BotConfig = bot_config_json;
const webdriver_config: WebDriverConfig = webdriver_config_json;

function init(): string {
    dotenv.config();
    if (bot_config.assistant_mode) {
        console.log("=================================================");
        console.log(" AI Assistant Mode");
        console.log(" The browser will open. Please:");
        console.log("   1. Click an empty seat [SIT]");
        console.log("   2. Enter your name and stack size, then submit");
        console.log("   3. Wait for the host to approve");
        console.log(" Once seated, AI monitors the game and shows a");
        console.log(" suggestion in the top-right on your turn.");
        console.log("=================================================\n");
    }
    return io("Enter the PokerNow game ID (e.g. https://www.pokernow.club/games/{game_id}): ");
}

const bot_manager = async function() {
    const game_id = init();

    const use_existing = webdriver_config.use_existing_browser ?? false;
    const debugging_port = webdriver_config.debugging_port ?? 9222;

    if (use_existing) {
        console.log(`\n[Connecting to existing Chrome on port ${debugging_port}]`);
        console.log(`  If Chrome is not running yet, start it first with:`);
        console.log(`  ./start-chrome.sh\n`);
    } else {
        if (bot_config.assistant_mode) {
            console.log("\nOpening browser — please sit down manually in the browser window.\n");
        }
    }

    const headless = webdriver_config.headless_flag && !bot_config.assistant_mode;
    const puppeteer_service = new PuppeteerService(
        webdriver_config.default_timeout,
        headless,
        use_existing,
        debugging_port
    );
    await puppeteer_service.init();

    const db_service = new DBService("./app/pokernow-gpt.db");
    await db_service.init();

    const player_service = new PlayerService(db_service);

    const log_service = new LogService(game_id);
    await log_service.init();

    const ai_service_factory = new AIServiceFactory();
    ai_service_factory.printSupportedModels();
    const ai_service = ai_service_factory.createAIService(ai_config.provider, ai_config.model_name, ai_config.playstyle);
    console.log(`Created AI service: ${ai_config.provider} ${ai_config.model_name} with playstyle: ${ai_config.playstyle}`);
    ai_service.init();

    const bot = new Bot(log_service, ai_service, player_service, puppeteer_service, game_id, bot_config.debug_mode, bot_config.query_retries, bot_config.assistant_mode);
    await bot.run();
}

export default bot_manager;