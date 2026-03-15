import fetch from 'node-fetch';
import type { Response } from '../utils/error-handling-utils.ts';
import { Data, Log } from '../interfaces/log-processing-interfaces.ts';

export class LogService {
    private game_id: string;
    
    constructor(game_id: string) {
        this.game_id = game_id;
    }

    async init(): Promise<void> {
        // No browser needed — logs are fetched directly via HTTP.
    }

    async closeBrowser(): Promise<void> {
        // Nothing to close.
    }

    async fetchData<D, E=Error>(before: string = "", after: string = ""): Response<D, E> {
        const url = `https://www.pokernow.club/games/${this.game_id}/log?before_at=${before}&after_at=${after}&mm=false&v=2`;
        try {
            const res = await fetch(url, {
                headers: {
                    "Accept": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
                }
            });
            if (!res.ok) {
                return {
                    code: "error",
                    error: new Error(`Log API returned status ${res.status}.`) as E
                }
            }
            const data = await res.json() as D;
            return {
                code: "success",
                data,
                msg: "Successfully got logs."
            }
        } catch (err) {
            return {
                code: "error",
                error: new Error(`Failed to fetch logs: ${err}`) as E
            }
        }
    }
    
    getData(log: any): Data {
        const data = log.data as JSON;
        const str = JSON.stringify(data);
        const res = JSON.parse(str) as Data;
        return res;
    }
    
    getMsg(data: Data): Array<string> {
        const res = new Array<string>;
        data.logs.forEach((element) => {
            res.push(element.msg)
        });
        return res;
    }
    
    getCreatedAt(data: Data): Array<string> {
        const res = new Array<string>;
        data.logs.forEach((element) => {
            res.push(element.created_at)
        });
        return res;
    }
    
    getLast(arr: Array<string>): string {
        return arr[arr.length - 1];
    }
    
    getFirst(arr: Array<string>): string {
        return arr[0];
    }
    
    pruneLogsBeforeCurrentHand(data: Data): Data {
        //starts from the top of logs
        const log_arr = new Array<Log>;
        let i = 0;
        while ((i < data.logs.length) && !(data.logs[i].msg.includes("starting hand #"))) {
            log_arr.push(data.logs[i]);
            i += 1;
        }
        log_arr.push(data.logs[i]);
        return {
            logs: log_arr
        }
    }
}
