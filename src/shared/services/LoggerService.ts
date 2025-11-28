export class LoggerService {
	private verboseLoggingEnabled: boolean = false; // verbose logging の状態を保持

	// INFO レベルのログは verbose が有効なときのみ出力する
	log(message: string, ...args: any[]): void {
		if (this.verboseLoggingEnabled) {
			console.log(`[INFO] ${message}`, ...args);
		}
	}

	// より詳細なログ（verbose）は verbose 設定が有効なときのみ出力
	verbose_log(message: string, ...args: any[]): void {
		if (this.verboseLoggingEnabled) {
			console.log(`[VERBOSE] ${message}`, ...args);
		}
	}

	warn(message: string, ...args: any[]): void {
		console.warn(`[WARN] ${message}`, ...args);
	}

	error(message: string, ...args: any[]): void {
		console.error(`[ERROR] ${message}`, ...args);
	}

	// 外部から設定を受け取り、内部状態を更新するメソッド
	updateSettings(settings: { verboseLoggingEnabled: boolean }): void {
		this.verboseLoggingEnabled = settings.verboseLoggingEnabled;
		this.verbose_log("LoggerService settings updated.", settings); // 設定更新ログはverboseで出す
	}

	// 将来的にログレベル管理や外部サービス連携を追加
}
