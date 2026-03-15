import { DebugMode } from "../utils/error-handling-utils.ts"

export interface AIConfig {
    provider: string,
    model_name: string,
    playstyle: string
}

export interface BotConfig {
    debug_mode: DebugMode,
    query_retries: number,
    /** When true, AI only shows suggestion in top-right; user clicks actions manually. */
    assistant_mode: boolean
}

export interface WebDriverConfig {
    default_timeout: number,
    headless_flag: boolean,
    /** Connect to an already-running Chrome instead of launching a new one. */
    use_existing_browser: boolean,
    /** Chrome remote debugging port (--remote-debugging-port). */
    debugging_port: number
}