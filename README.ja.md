# freee MCP + CLI + Agent Skill

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

このプロジェクトは、Claude Code、Codex、OpenCode、Pi などのローカルコーディング Agent から、freee 人事労務の勤怠ワークフローを安全かつテスト可能な形で操作できるようにします。ビジネスロジックは一つの共通コアサービスに集約され、ローカル STDIO MCP Server、CLI、共通 Agent Skill を通じて提供されます。コアは、freee Public API と制御された Playwright ブラウザー自動化という、相互排他的な二つのバックエンドをサポートします。

## コーディング Agent からインストールする

Claude Code、Codex、Pi、OpenCode、または別のローカルコーディング Agent を使用していますか？次のプロンプトをその Agent に貼り付けてください。

```text
現在実行中のコーディング Agent に、https://github.com/newbdez33/freee-mcp から freee MCP と Agent Skill をインストールしてください。現在の Agent が Claude Code、Codex、Pi、OpenCode、またはその他のどれかを判定し、README に記載された対応するユーザースコープのインストール方法に従ってください。Agent ネイティブのプラグインまたはパッケージマネージャーを優先し、それがなければ文書化されたポータブル STDIO MCP コマンドを登録し、skills/freee を Agent のグローバル Skill 位置にインストールしてください。リポジトリの clone、このリポジトリからの Agent 起動、プロジェクトスコープ設定の追加は求めないでください。freee のユーザー名、パスワード、Client Secret、Token をチャットやコマンド引数に貼り付けるよう求めないでください。認証情報がない場合は、MCP または付属 CLI が返したローカル System Keychain 設定コマンドをそのまま表示してください。インストール時は読み取り専用の認証とツール検出だけを確認し、実際の打刻や承認は行わないでください。
```

このリポジトリは公開されています。GitHub アカウントやローカル作業コピーは不要です。選択された Agent がプラグイン、パッケージ、または npm キャッシュを内部で管理します。インストールされたツールと Skill はユーザースコープで、どのプロジェクトディレクトリからでも利用できます。

### Claude Code

Claude Code は、ネイティブプラグイン marketplace を通じて MCP と Skill の両方をインストールします。

```bash
claude plugin marketplace add https://github.com/newbdez33/freee-mcp.git
claude plugin install freee@freee-tools --scope user
```

既存の Claude Code セッションで `/reload-plugins` を実行するか、任意のディレクトリから新しいセッションを開始します。プラグインはローカル STDIO MCP Server と freee Skill をユーザースコープで読み込みます。このリポジトリから Claude Code を起動する必要はありません。接続は `/mcp` で確認できます。

Playwright の初回認証では、Claude に freee の認証状態を確認させてください。認証情報がない場合、インストール方法に対応したコマンドが返ります。その正確なコマンドを、ローカルの対話型ターミナルで自分で実行してください。コマンドはユーザー名とパスワードの入力を隠し、System Keychain に保存します。MCP のインストールや承認処理が freee の認証情報を受け取ることはありません。

#### Claude Code の更新

勤怠操作コードが利用者の知らない間に変わらないよう、更新は既定で明示的に行います。更新したい場合は次のプロンプトを Claude Code に貼り付けてください。

```text
インストール済みの freee@freee-tools Claude Code プラグインと marketplace を更新し、プラグインを再読み込みして freee MCP 接続を確認してください。プラグインデータ、System Keychain の認証情報、外部 Playwright profile は保持してください。ソースリポジトリを手動で clone せず、実際の freee 打刻や承認は行わないでください。
```

同等の手動更新コマンドは次のとおりです。

```bash
claude plugin marketplace update freee-tools
claude plugin update freee@freee-tools --scope user
```

その後 `/reload-plugins` を実行します。Claude Code はリポジトリの checkout や MCP の再登録なしで、MCP と Skill を新しいキャッシュ済みバージョンへ切り替えます。通常の更新では、System Keychain の項目、永続プラグインデータ、外部 `~/.freee-agent/playwright-profile` は維持されます。

プラグインのリリースはセマンティックバージョニングを使用します。メンテナーは `package.json` と `.claude-plugin/plugin.json` を同時に更新する必要があり、テストスイートが一致を検証します。明示的な更新が成功するまで、利用者は最後にインストールしたバージョンを使い続けます。

### Codex

Codex は Skill installer で `skills/freee` をインストールし、次のバージョン固定されたポータブル STDIO コマンドをユーザースコープに登録します。

```bash
codex mcp add freee -- npx --yes --package='github:newbdez33/freee-mcp#v0.4.4' freee-mcp
```

冒頭のインストールプロンプトが Codex に両方の手順を実行させます。新しい Skill がすぐに検出されない場合は Codex を再起動し、`/mcp` で Server 接続を確認してください。

### OpenCode とその他の MCP クライアント

クライアント設定または MCP installer を使用し、次のコマンドをユーザーレベルの STDIO MCP として登録します。

```bash
npx --yes --package='github:newbdez33/freee-mcp#v0.4.4' freee-mcp
```

このリポジトリの `skills/freee` をクライアントのグローバル Agent Skills 位置へインストールします。OpenCode は `~/.agents/skills/freee` を認識します。他の Agent Skills 対応クライアントではユーザーレベルの場所が異なる場合があります。冒頭のインストールプロンプトにより、プロジェクトファイルを作らずに実行中の Agent が適切な場所を選択できます。

### Pi

リポジトリをユーザーレベルの Pi package としてインストールします。

```bash
pi install git:github.com/newbdez33/freee-mcp
```

Pi は同梱された `skills/freee` を読み込みます。インストール先の Pi 環境に MCP 拡張がない場合、Skill はパッケージ付属 CLI を使用します。CLI は同じコアサービスを呼び出し、同じ書き込み確認を適用します。

### 既存インストールの更新

インストールを管理する Agent に次のプロンプトを貼り付けてください。

```text
現在実行中のコーディング Agent の更新方法を使い、https://github.com/newbdez33/freee-mcp からユーザースコープの freee インストールを更新してください。Claude Code では freee-tools と freee@freee-tools を更新してからプラグインを再読み込みしてください。Codex、OpenCode、その他のポータブル MCP インストールでは、MCP コマンドの固定 GitHub Release tag を更新し、グローバル skills/freee を更新してください。Pi ではインストール済み Pi package を更新してください。~/.freee-agent、Claude プラグインデータ、System Keychain の認証情報、外部 Playwright profile は保持してください。Agent を再起動または再読み込みし、読み取り専用 MCP 接続または CLI status だけを確認してください。ソースリポジトリを手動で clone せず、実際の freee 打刻や承認は行わないでください。
```

Pi の同等の手動更新は `pi update` です。ポータブル MCP インストールでは意図的に Release tag を固定します。更新で置き換わるのは MCP 登録と Skill のコードバージョンだけで、認証情報とブラウザー状態はパッケージキャッシュの外部に残ります。

## 設計方針

- `FREEE_BACKEND=api|playwright` は各ビジネス操作のバックエンドを明示的に選択します。既存 API 設定を検出して選ぶのは `auto` だけです。
- バックエンドの失敗はその操作の最終結果です。別のバックエンドへフォールバックしません。
- MCP 対応 Agent では MCP が主要なビジネス操作インターフェースであり、ツール検出、入力 Schema、読み取り専用 annotation、クライアント側の書き込み承認プロンプトを提供します。
- CLI は OAuth 設定、System Keychain 設定、トラブルシューティングのための決定的なローカルインターフェースとして残します。
- MCP と CLI は同じ `FreeeService` を呼び出し、認証、ビジネスルール、バックエンド選択を重複実装しません。
- 共通 Agent Skill は MCP を優先し、MCP が利用できない場合またはローカル設定が必要な場合だけ CLI を使うよう案内します。インターフェースを切り替えてエラーを回避してはいけません。
- Playwright バックエンドは freee のユーザー名とパスワードを System Keychain に保存し、想定された freee 公式ログインページでのみ入力します。
- 旧 `freee-checkin` プロジェクトはログインフローと selector の参考にしましたが、その `.env` パスワード、強制クリック、環境変数ログ、未確認の定期書き込みは再利用しません。

## ビジネス機能の状況

次の表は現在の `main` ブランチを示します。「対応済み」は、動作と安全停止条件が自動 unit test または protocol test でカバーされていることを意味し、実際の freee 書き込みを実行したという意味ではありません。実環境の証跡は[実環境検証チェックリスト](docs/live-validation-checklist.md)、今後の実装は [TODO.md](TODO.md) で管理します。

| ビジネス機能 | バックエンド | 実装状況 | 自動テスト | freee 実環境検証 |
| --- | --- | --- | --- | --- |
| バックエンド選択と認証状態 | API + Playwright | 完了。操作ごとに一つだけ選択 | 対応済み | API OAuth/System Keyring と Playwright System Keychain/headless ログインを検証済み |
| 現在のユーザーと事業所 | API | 完了。Playwright の本人情報取得は未実装 | 対応済み | API 経路を検証済み |
| 現在の打刻状態と利用可能操作 | API + Playwright | 完了 | 対応済み | 両方の読み取り経路を検証済み |
| 出勤、休憩開始/終了、退勤 | API + Playwright | 現在時刻の打刻に対応 | 確認と状態変更拒否を含め対応済み | 実書き込みは未検証（`LV-W01`、`LV-W02`） |
| 本人の月次状態、警告、勤務月ナビゲーション | Playwright | 完了 | 対応済み | 現在月の状態/警告と月跨ぎナビゲーションを検証済み。残りの状態パターンは未検証（`LV-R04`） |
| 本人の独立した月次集計と欠勤/遅刻/早退の詳細異常 | API + Playwright | 未実装。カレンダー警告と管理者集計では一部のみ取得 | — | — |
| 本人の月次勤怠締め申請を提出 | Playwright | prepare/commit fingerprint 付きで完了 | 対応済み | 未検証（`LV-W03`） |
| 未承認の本人月次勤怠締め申請を取り下げ | Playwright | prepare/commit fingerprint 付きで完了 | 対応済み | 未検証（`LV-W04`） |
| 利用可能な本人申請種別と休暇種別を取得 | Playwright | 完了 | 対応済み | 全休、時間指定半休、特別休暇、修正フォームの各パターンを検証済み |
| 本人申請の一覧、絞り込み、ページング、詳細 | Playwright | 完了 | 対応済み | 申請中/差戻し/承認済/全てと正確な詳細を検証済み。2 ページ目は未検証（`LV-R03`） |
| 休暇申請を作成 | Playwright | 時間指定休暇を含め完了 | 対応済み | 検証済み（`LV-W05`） |
| 勤務時間修正を作成 | Playwright | 1 勤務区間と任意の完全な休憩 1 組に限定 | 対応済み | 読み取り専用フォームパターンを検証済み。実書き込みは未検証（`LV-W06`） |
| 残業申請を作成 | Playwright | 未実装。無効または未検証のフォームでは安全停止 | 安全拒否を対応済み | 現在の検証アカウントではフォームが無効 |
| 未承認の本人申請を取り下げ | Playwright | prepare/commit fingerprint 付きで完了 | 対応済み | 検証済み（`LV-W07`） |
| 承認済み本人申請を取消申請 | Playwright | 別の取消申請を作成・検証する形で完了 | 対応済み | 最終承認まで検証済み（`LV-W09`） |
| 部門の月次勤怠・不備集計 | Playwright | 現在画面で参照可能な管理範囲に対応 | 対応済み | 現在月の集計と日付不一致ガードを検証済み |
| Public API による部門の日次打刻状態 | API | 実装済みだが role に依存 | 対応済み | `attendance_manager` の想定権限拒否を検証済み。権限を持つ role での成功は未検証（`LV-R08`） |
| 日付指定の従業員打刻詳細 | Playwright | 未実装 | — | — |
| 子部門の再帰集計 | Playwright | 未実装 | — | — |
| 管理者申請の一覧、絞り込み、ページング、詳細 | Playwright | 完了 | 対応済み | 絞り込み、ページング、正確な詳細、処理済み履歴を検証済み |
| 一般従業員申請を承認 | Playwright | 個別操作と確認済み条件付き実行に対応。各項目は prepare/commit fingerprint を使用 | 対応済み | 書き込み後の詳細確認を含む単一項目 flow を検証済み |
| 一般従業員申請を差し戻し | Playwright | 個別操作と確認済み条件付き実行に対応。各項目は prepare/commit fingerprint を使用 | 対応済み | 単一項目 flow を検証済み（`LV-W08`） |
| 月次勤怠締め申請の一覧と完全レビュー | Playwright | 月次集計、日次行、警告、チェック、検証付き期間移動を含め完了 | 対応済み | 承認済み履歴の完全レビューを検証済み。自然発生した未承認申請での月跨ぎと prepare fingerprint は未検証（`LV-R11`） |
| 月次勤怠締め申請を承認または差し戻し | Playwright | 個別操作と確認済み条件付き batch に対応。各項目は完全レビューを束縛する専用 fingerprint を使用 | 対応済み | 単一項目の書き込みは未検証（`LV-W10`） |
| 差戻し済みまたは下書きの本人申請を削除 | Playwright | 未実装 | — | — |
| 条件付き manager approval batch | Playwright | 一般承認と専用月次承認を、検証済みの単一項目 commit で順次実行する形で対応 | MCP と Skill の assertion で対応 | 単一項目 flow を個別にテスト |
| 永続化 batch-policy state と監査ログ | Playwright | 未実装。Agent が確認済み範囲の policy を run 中保持 | — | — |

## 開発クイックスタート

```bash
npm ci
npm test
npm run validate
npm run package:smoke
```

エンドユーザーは実行時にこの checkout を使用しません。ローカルプラグイン開発では、1 回の Claude Code セッションにリポジトリを明示的に読み込めます。

```bash
claude --plugin-dir /absolute/path/to/freee-mcp
```

リポジトリの `.codex/config.toml` は Codex 開発設定です。Claude プラグイン manifest は `.claude-plugin/plugin.json`、marketplace は `.claude-plugin/marketplace.json` です。プラグインはキャッシュパスと永続データディレクトリを自分で解決するため、Claude Code も MCP もユーザーの現在の作業ディレクトリに依存しません。

Codex 設定は `default_tools_approval_mode = "writes"` を維持するため、無関係な commit ツールは引き続きクライアント承認を要求します。一方、manager 用の `freee_approval_commit_action` と `freee_monthly_approval_commit_action` のツール単位 mode は `approve` に設定します。これにより、明示確認済みの manager approval policy run は項目ごとの追加 prompt なしで単一項目 commit を連続実行できます。Server は各 commit で引き続き `confirm: true`、一致する preview fingerprint、現在の freee 状態、すべての休暇依存関係、月次の支払月/勤務月対応を検証します。

### メンテナー向けリリース手順

すべての Pull Request と `main` への push で、テスト、Claude プラグインと canonical Agent Skill の検証、Git 履歴の Secret scan、隔離 npm キャッシュからのパッケージ済み CLI/MCP 起動を実行します。GitHub Action の依存は完全な commit SHA に固定されています。

リリースはリポジトリの `main` ブランチから明示的にのみ実行します。

1. `package.json`、`package-lock.json`、`.claude-plugin/plugin.json`、3 言語すべての README のポータブルコマンドにある `#v...` を同じ SemVer に更新します。
2. CI 成功後にバージョン変更を merge します。
3. GitHub Actions で `main` から `Release` workflow を実行し、`v` なしのバージョンを入力します。

workflow は全検証を再実行し、現在の `main` commit に annotation 付き `vVERSION` tag を作成または確認し、merge 済み内容から英語の Release notes を生成し、ポータブルパッケージと SHA-256 checksum を添付します。npm へは公開せず、freee の認証情報も受け取りません。

## MCP ツール

| MCP ツール | 種別 | 用途 |
| --- | --- | --- |
| `freee_backend_status` | 読み取り専用 | MCP バージョンと排他的に選択されたバックエンドを表示 |
| `freee_auth_status` | 読み取り専用 | 認証情報を返さず認証状態を確認 |
| `freee_me` | 読み取り専用 | API バックエンドで現在のユーザーと事業所を取得 |
| `freee_clock_status` | 読み取り専用 | 現在利用可能な打刻操作を表示 |
| `freee_clock_prepare_action` | 読み取り専用 preview | 打刻 preview と fingerprint を生成 |
| `freee_clock_commit_action` | 書き込み | fingerprint を再検証し、実際の打刻を 1 件作成 |
| `freee_team_status` | 読み取り専用 | 部門または現在の Web 管理範囲の月次集計を取得 |
| `freee_monthly_status` | 読み取り専用 | 指定または選択中の本人 `月次勤怠締め` 月を取得 |
| `freee_monthly_prepare_action` | 読み取り専用 preview | 月次提出または取下げの preview と fingerprint を生成 |
| `freee_monthly_commit_action` | 書き込み | fingerprint を再検証し、月次申請を提出または取り下げ |
| `freee_personal_application_options` | 読み取り専用 | 利用可能な本人申請種別と日付別休暇種別を表示 |
| `freee_personal_applications_list` | 読み取り専用 | 現在の従業員の申請中、差戻し、承認済み、全申請を一覧 |
| `freee_personal_application_detail` | 読み取り専用 | 本人申請 1 件と利用可能操作を取得 |
| `freee_personal_application_prepare_create` | 読み取り専用 preview | 休暇または勤務時間修正フォームを入力・検証し fingerprint を生成 |
| `freee_personal_application_commit_create` | 書き込み | 再検証して本人申請を 1 件提出 |
| `freee_personal_application_prepare_cancel` | 読み取り専用 preview | 承認済み本人申請の取消を検証し fingerprint を生成 |
| `freee_personal_application_commit_cancel` | 書き込み | 再検証して承認済み申請への取消申請を作成 |
| `freee_personal_application_prepare_withdraw` | 読み取り専用 preview | 未承認本人申請の取下げ preview と fingerprint を生成 |
| `freee_personal_application_commit_withdraw` | 書き込み | 再検証して未承認本人申請を取り下げ |
| `freee_approvals_list` | 読み取り専用 | 未承認、承認済み、差戻し、全申請を一覧 |
| `freee_monthly_approvals_list` | 読み取り専用 | `月次勤怠締め` を明示的な支払月と対応付けた勤務月とともに一覧 |
| `freee_monthly_approval_review` | 読み取り専用 | 支払月/勤務月を検証し、申請者の集計、日次勤怠、警告、自動チェックをレビュー |
| `freee_monthly_approval_prepare_action` | 読み取り専用 preview | 両期間と完全な月次レビュー/操作を fingerprint に束縛 |
| `freee_monthly_approval_commit_action` | 書き込み | 両期間を再導出し、完全レビューを再検証して承認または差し戻し |
| `freee_approval_detail` | 読み取り専用 | 申請 1 件の完全な詳細と、対応する勤務時間修正の変更前/変更後を構造化して取得 |
| `freee_approval_prepare_action` | 読み取り専用 preview | 承認または差戻し preview と fingerprint を生成 |
| `freee_approval_commit_action` | 書き込み | fingerprint を再検証し申請 1 件を承認または差し戻し |

MCP Server は手動でも起動できます。

```bash
npm run mcp
```

STDIO protocol のプロセスです。通常はクライアントが自動起動するため、別のターミナルウィンドウを開いたままにする必要はありません。

## ソース開発用 CLI コマンド

インストール利用者は Agent が MCP に対応していれば任意のディレクトリから MCP を使用してください。ローカル対話設定が必要な場合、MCP またはインストール済み Skill がパッケージから解決した絶対コマンドを提供します。次の `npm run freee --` は、ソース checkout で作業するメンテナー向けです。

```bash
# 読み取り専用
npm run freee -- backend status
npm run freee -- auth status
npm run freee -- me
npm run freee -- clock status
npm run freee -- team status
npm run freee -- monthly status --period YYYY-MM
npm run freee -- requests options --date YYYY-MM-DD
npm run freee -- requests list --status pending|returned|approved|all --page 1
npm run freee -- requests detail --id APPLICATION_NO
npm run freee -- approvals list
npm run freee -- approvals list --status all
npm run freee -- approvals list --status approved --page 2
npm run freee -- approvals detail --id APPLICATION_NO
npm run freee -- monthly-approvals list --status pending|returned|approved|all --page 1
npm run freee -- monthly-approvals review --id APPLICATION_NO
npm run freee -- browser status
npm run freee -- browser credentials-status

# Playwright の認証情報を System Keychain に安全に設定
npm run freee -- browser configure --confirm

# 打刻：ユーザーがその操作を明示的に依頼した場合だけ --confirm を使用
npm run freee -- clock in --confirm
npm run freee -- clock break-start --confirm
npm run freee -- clock break-end --confirm
npm run freee -- clock out --confirm

# 月次勤怠：先に prepare し、明示的なレビューと承認後だけ commit
npm run freee -- monthly prepare-action --action submit|withdraw --period YYYY-MM
npm run freee -- monthly commit-action --action submit|withdraw \
  --period YYYY-MM --fingerprint PREVIEW_SHA256 --confirm

# 本人申請：options、prepare、review の後に commit
npm run freee -- requests prepare-create --kind leave --date YYYY-MM-DD \
  --leave-type "EXACT_FREEE_LABEL" \
  [--leave-start HH:MM --leave-end HH:MM] --reason "REASON"
npm run freee -- requests commit-create --kind leave --date YYYY-MM-DD \
  --leave-type "EXACT_FREEE_LABEL" \
  [--leave-start HH:MM --leave-end HH:MM] --reason "REASON" \
  --fingerprint PREVIEW_SHA256 --confirm
npm run freee -- requests prepare-create --kind work-time-correction \
  --date YYYY-MM-DD --clock-in HH:MM --clock-out HH:MM \
  [--break-start HH:MM --break-end HH:MM] [--reason "REASON"]
npm run freee -- requests prepare-cancel --id APPLICATION_NO [--reason "REASON"]
npm run freee -- requests commit-cancel --id APPLICATION_NO [--reason "REASON"] \
  --fingerprint PREVIEW_SHA256 --confirm
npm run freee -- requests prepare-withdraw --id APPLICATION_NO
npm run freee -- requests commit-withdraw --id APPLICATION_NO \
  --fingerprint PREVIEW_SHA256 --confirm

# 従業員申請：各項目を prepare し、個別確認または有効な policy で commit
npm run freee -- approvals prepare-action --id APPLICATION_NO --action approve|return
npm run freee -- approvals commit-action --id APPLICATION_NO \
  --action approve|return --fingerprint PREVIEW_SHA256 --confirm

# 月次承認：各項目を完全レビューし、個別確認または有効な policy で commit
npm run freee -- monthly-approvals prepare-action \
  --id APPLICATION_NO --action approve|return
npm run freee -- monthly-approvals commit-action \
  --id APPLICATION_NO --action approve|return \
  --fingerprint PREVIEW_SHA256 --confirm
```

コマンドは JSON を出力し、選択されたビジネスバックエンドを示します。実打刻前には同じバックエンドで利用可能操作を再確認し、申請操作前には完全な詳細を再取得して SHA-256 fingerprint が読み取り専用 preview と一致することを要求します。操作不可、詳細変更、画面の曖昧さ、確認不足は API POST またはブラウザークリックより前に停止します。commit が完全な JSON envelope を返さなかった場合は結果不明として扱い、書き込みを再実行しないでください。対応する読み取り専用 status、list、detail で正確な対象を確認します。

MCP と CLI の書き込みは同じ安全モデルに従います。各実操作では prepare ツールまたはコマンドと変更されていない fingerprint を使用します。打刻、本人月次操作、本人申請は現在メッセージでの個別承認が必要です。一般従業員承認と専用月次 manager 承認は、個別承認に加えてユーザー確認済みの条件付き batch policy を利用できます。Agent が選択条件、`approve`/`return` の対応、範囲と終了条件、依存順序、項目別 error 処理を復唱し、ユーザーがその policy を 1 回確認します。範囲は完全 scan 1 回、一致項目がなくなるまでの反復 scan、明示範囲/件数上限、または設定済み定期 automation とでき、申請 No. や fingerprint の事前列挙は不要です。Agent は未承認の全 source page を読み、一般申請の完全詳細または月次の完全レビューを評価し、単一項目 interface で一致項目を順に prepare、commit、検証し、fingerprint をユーザーに代わって照合します。これは MCP が対応する batch automation で、単独の不一致や曖昧な項目は skip して独立項目を継続できます。結果不明の書き込みは再試行しません。開発・テスト依頼は実書き込みを許可しません。

API 版 `team status` は実装・自動テスト済みですが、GCU で使われる `attendance_manager` role は Public API から従業員所属を参照できません。API バックエンドは権限エラーを返し、Playwright へフォールバックしません。

Playwright バックエンドは System Keychain 認証情報、永続ログイン、本人打刻状態と操作、本人月次の提出/取下げ、本人申請の一覧/詳細/休暇/勤務時間修正/取下げ/承認済み申請の取消、部門月次集計、一般従業員申請処理、専用月次レビュー/承認/差戻しに対応します。freee ホームから Employee Portal に入り、本人打刻コントロール、表示可能メンバー、締め申請、勤怠不備、月次労働時間、対象申請者の正確な日次勤怠表を読み取り、申請ワークフローで許可された操作を処理します。ブラウザー profile はリポジトリ外に保存されます。

## 月次勤怠申請

`monthly status` は指定勤務月を読み取り、`--period` を省略すると freee で現在選択中の月を読み取ります。`--period YYYY-MM` を指定すると、Playwright は現在の支払月/勤務月の組み合わせを読み取り、その差を維持して公式の上限付き年月 navigator を使い、状態解析前に期待する支払月と要求勤務月の両方が表示されていることを検証します。navigator の欠落/曖昧さ、期間 label の異常、遷移後検証の失敗では安全停止します。結果には正規化状態、freee 状態 label、該当申請、利用可能操作、および申請・修正が必要な日など表示中のカレンダー警告が含まれます。Agent はすべての非空警告を提示し、ユーザーが freee で解決または明示的に確認するまで提出してはいけません。

月次の書き込みは他の書き込みと同じ 2 段階安全モデルです。`monthly prepare-action --action submit` は作成フォームを開き、対象月、申請経路、承認ステップ、フォームチェック、カレンダー警告を読み取りますが、最終 `申請` ボタンはクリックしません。カレンダー警告は fingerprint に含まれます。`--action withdraw` は正確な未承認申請を読み、`申請を取り下げる` が利用可能であることを確認します。commit は完全 preview を再取得し、fingerprint が不変で現在のメッセージに明示確認がある場合のみ 1 回クリックし、最終月次状態を検証します。曖昧または結果不明の場合は自動再試行しません。

## 本人勤怠申請

`requests list` は従業員側の `申請` tab を明示選択し、`申請中`、`差戻し`、`承認済`、`全て` filter を対応する freee response と同期してから解析します。`requests detail` は従業員側の全ページから正確な No. を検索し、表示・有効な `申請を取り下げる` が一つある場合は `withdraw`、承認済み項目に正確な公式 `取消申請` link がある場合は `cancel` を返します。

申請作成前に `requests options` を呼び出してください。`--date` を付けると、会社がその日付に設定した正確な休暇種別を読み取ります。休暇と 1 勤務区間の勤務時間修正に対応し、勤務時間修正には任意の休憩 1 組を含められます。現在のテスト会社では `残業` が有効でないため、機能結果は残業を利用不可として返し、未検証フォームを推測・迂回しません。

作成、承認済み申請の取消、未承認申請の取下げは別々の prepare/commit を使います。取消 prepare は元の承認済み申請、任意の取消理由、公式 `ApprovalRequest::Revoke` フォーム、申請経路、最近の申請一覧を fingerprint に束縛します。commit は新しい取消申請を一つだけ作成・検証します。新しい取消申請が承認されるまで、元の休暇を取消済みとは報告しません。作成と取消の prepare は最終 `申請` をクリックせず、取下げ prepare は `申請を取り下げる` をクリックしません。各 commit は同じ preview を再構築し、変更があれば停止し、現在メッセージの明示承認後に 1 回だけクリックして結果を検証します。結果不明なら自動再試行しません。

## 従業員申請の処理

`approvals list` は管理者側 `承認` tab を明示選択し、既定で `未承認` queue を読みます。既定の従業員側 `申請` を承認 queue として扱いません。各結果には申請者が含まれます。`--status returned|approved|all` は他の管理者状態を読み、`--page N` は 1 ページを選択します。結果は `page`、`pageCount`、`totalCount`、現在ページの `applicationCount` を返し、Agent が無制限の履歴を一度に出力する必要をなくします。ブラウザーは正確な freee response と一致する描画行数を待ち、別 filter の古い DOM を返しません。`approvals detail --id` はページ分割された管理者 workflow 全体から検索し、申請項目、承認経路、部門、コメント、freee 自動チェック結果を返します。対応する `勤務時間修正` では、`workTimeChange` が出勤、退勤、休憩開始、休憩終了の `before`/`after` 値を構造化して返し、`null` は freee の `未入力` を表します。同じ比較は承認 preview と安全 fingerprint にも含まれます。どちらも読み取り専用です。

一般申請は 1 件ずつ、引き続き 2 段階で書き込みます。

1. `approvals prepare-action` は現在の完全詳細を読み、要求ボタンが利用可能か確認し、業務コントロールをクリックせず preview と content fingerprint を返します。
2. ユーザーが申請者、種別、対象日、内容、理由、自動チェックを確認し、現在のメッセージで承認または差戻しを明示的に依頼した場合だけ、Agent は同じ申請番号、操作、fingerprint で `approvals commit-action ... --confirm` を呼び出せます。

ユーザーは条件付き batch policy を許可することもできます。Agent は正確な条件、`approve` または `return` の対応、範囲と終了条件、依存関係に安全な順序、項目別失敗処理を復唱し、1 回の明示確認でその範囲の policy を有効にします。その後は各 scan で未承認の全ページと完全詳細を読み、一致申請を順に prepare、commit し、ユーザーが fingerprint を項目ごとに確認または承認する必要はありません。クリック前失敗と明示された preview 変更は、同じ policy の下で再読込・prepare できます。`休暇` を承認する前には prepare と commit の両方が未承認の全ページから同一申請者・同一日付の `勤務時間修正` を探し、policy がその修正を許可する場合は先に処理し、それ以外は休暇を skip します。単独の不一致、操作不可、曖昧さはその項目だけ skip して独立申請を継続します。結果不明の項目は再試行せず、その項目と休暇依存 chain を隔離します。許可の期限切れ/不明確化、backend/identity 変更、信頼できない pagination、その他の system-level safety failure の場合だけ run 全体を停止します。

commit 前に CLI は詳細を再取得します。fingerprint 不一致、ボタン欠落、他者による処理、新しいコメントがあれば停止し、新しい preview を要求します。クリック後は同期されたページング workflow で申請を再取得し、最終状態が正確に `承認済` または `差戻し` でなければなりません。本人申請が差戻し後に管理者履歴から消えた場合、従業員履歴にある同じ No. と不変の対象項目で検証できます。両方に存在しない、または対象が異なる場合は結果不明とし、自動再試行しません。開発テストは実際の承認や差戻しを行いません。

## 月次勤怠承認レビュー

`monthly-approvals list` は同期された管理者承認 1 ページから `月次勤怠締め` を絞り込みます。`2026年09月の支払分` のような文言から明示的な支払月を 1 つ解析し、freee 表示中の支払月/勤務月対応から勤務月を導出し、公式 navigator でその組み合わせを検証して `paymentPeriod` と勤務 `period` を返します。支払月や `対象日` を勤務月として扱わず、1 か月減算を固定しません。後続の元ページを確認する場合は `pageCount` を使用します。`sourceTotalCount` は種別絞り込み前の全件数、`applicationCount` は返却ページ内の月次件数です。

`monthly-approvals review --id` は正確な申請種別と `対象日` に整合する明示的な支払月を確認します。その支払月を freee 表示中の対応関係から勤務月へ写像し、勤怠モニターを対象勤務月へ移動して、申請者を表示中の一意なメンバーへ対応付け、公式従業員勤怠ページを開き、日次表を読む前に同じ支払月/勤務月の組み合わせを再確認します。対応関係が欠落または曖昧な場合は `MONTHLY_APPROVAL_PERIOD_MAPPING_UNCONFIRMED`、月不一致、従業員の重複、公式勤怠 link の欠落、table schema 変更では安全停止し、不完全なレビューを返しません。成功時は両期間、月次集計、一意に識別した日次勤怠表、日別 alert、ページ警告、申請詳細、統合自動チェックを返します。

月次の各管理者書き込み前には `monthly-approvals prepare-action --id NO --action approve|return` を使用します。fingerprint は明示的な支払月、freee で検証した勤務月、完全な申請、月次集計、日次行、警告、チェック、要求操作を束縛します。`monthly-approvals commit-action ... --confirm` は、新しい現在メッセージで正確な preview を個別確認した場合、または有効な確認済み manager approval batch policy に一致した場合に許可されます。そのため Agent は 1 回の許可 run で月次申請を条件付き承認または差戻しできますが、内部では 1 件ずつ処理します。各 commit は対応関係を再導出してレビューを再構築し、正確な申請を再度開き、どちらかの月または束縛データが変わっていればクリック前に停止します。1 回クリックした後は一般承認と同じ書き込み後検証を行います。この専用単一項目 write path は実 freee 検証待ちです（`LV-W10`）。

## バックエンド選択

バックエンドは次の優先順で 1 回だけ選択し、操作中に混在させません。

1. `FREEE_BACKEND=api`：Public API のみ使用します。
2. `FREEE_BACKEND=playwright`：API 設定が残っていても Playwright のみ使用します。
3. 未設定または `FREEE_BACKEND=auto`：API 設定があれば API、なければ Playwright を選択します。

ソース開発 checkout では次のように選択できます。

```dotenv
FREEE_BACKEND=playwright
FREEE_BROWSER_HEADLESS=true
```

`.env` には非機密の switch だけを置き、ユーザー名、パスワード、Token、Client Secret を保存しないでください。

## API 認証情報

CLI は二つの認証情報モードをサポートします。

- `system`：通常かつ推奨のモード。Client Secret と OAuth Token を macOS Keychain、Windows Credential Manager、Linux system keyring に保存します。
- `environment`：CI、Server、一時 Access Token 向け。Refresh Token を自動更新できません。

設定には Client ID、callback address、backend metadata だけが含まれ、Client Secret や Token は含まれません。ソース checkout は `.freee/oauth.json`、Claude プラグインは永続プラグインデータディレクトリに同じ非機密データを保存します。

Claude プラグインをインストール済みの場合は Claude に API バックエンドの設定を依頼します。インストール済み Skill がプラグインから解決した CLI コマンドを提供し、非機密設定を永続プラグインデータへ保存します。次のソース checkout コマンドは開発用です。

### System Keyring（推奨）

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
```

コマンドは隠された対話プロンプトから Client Secret を読み取り、Client Secret と OAuth Token 一式を OS の認証情報ストアへ保存します。Access Token と 1 回限りの Refresh Token は同時に更新されます。

### Environment モード（CI または一時利用）

CI Secret、container Secret、または親プロセスから `FREEE_ACCESS_TOKEN` を注入し、次を実行します。

```bash
npm run freee -- auth configure --store environment --confirm
```

Environment モードは freee が返す新しい Refresh Token を安全に永続化できないため、OAuth login と自動 refresh をサポートしません。実 Token をリポジトリの `.env` に保存しないでください。

## OAuth 更新

freee 開発アプリに次の正確な callback URL を設定します。

```text
http://127.0.0.1:48181/callback
```

ユーザーがその場で明示的に認可へ同意した場合に、次を実行します。

```bash
npm run freee -- auth configure --store system --client-id YOUR_CLIENT_ID --confirm
npm run freee -- auth login --confirm
npm run freee -- auth status
```

`auth login` は freee 公式認可ページを開き、ランダムなローカル callback `state` を検証し、Token を System Keyring に書き込みます。

認可後、CLI は Access Token の期限前に refresh します。401 response でも最大 1 回の refresh と 1 回の retry だけを行います。freee Refresh Token はすべて 1 回限りなので、毎回新しい Access Token と Refresh Token を一緒に保存します。プロセス間 lock により Codex と Claude Code が同じ Refresh Token を同時に消費することを防ぎます。

ソース checkout の `.freee/oauth.json` に Token や Secret は含まれず、Git から無視されます。プラグイン側の同等データは永続プラグインデータ内にあり、通常のプラグイン更新後も保持されます。

## Playwright 認証情報

インストール済みプラグインでは、Claude に freee 認証を確認させ、返された正確な `setupCommand` をローカル対話型ターミナルで直接実行します。ソース開発での同等コマンドは次のとおりです。

```bash
npm run freee -- browser configure --confirm
```

コマンドはユーザー名、パスワード、パスワード確認を隠されたプロンプトで読み、System Keychain へ書き込んで readback を検証します。出力に認証情報は含まれません。ユーザー名/パスワード option は受け付けず、`.env`、MCP 引数、チャットから認証情報を読みません。

設定コマンドが返す正確な `nextStep` で初回ログインを完了します。ソース checkout での同等コマンドは次のとおりです。

```bash
FREEE_BROWSER_HEADLESS=false npm run freee -- browser status
```

Playwright は `accounts.secure.freee.co.jp` を検証してから認証情報を入力し、main-frame navigation を `p.secure.freee.co.jp` と `ep.secure.freee.co.jp` に制限します。ユーザーは表示ブラウザーで MFA、CAPTCHA、異常ログイン確認を完了します。成功した session は private な永続 profile に cache され、session 期限切れ時は System Keychain 認証情報が復旧元になります。その後 headless mode に戻せます。

headless mode では、選択されたローカル Chrome channel から User-Agent を導出し、永続 session 起動前に `HeadlessChrome` product token だけを除去します。Playwright は対応する request header と User-Agent Client Hints を維持します。これは限定的な User-Agent 正規化です。`navigator.webdriver` は有効なままで、stealth や fingerprint 回避 package は使わず、サイトがブラウザー自動化を認識できないとは主張しません。

MCP が初めて Web 認証情報の不足を検出すると、`freee_auth_status` または別のツールがローカル設定コマンドを返します。Agent はそのコマンドをユーザーに表示するだけで、チャットでユーザー名やパスワードを要求・収集してはいけません。

永続ブラウザー profile の既定は `~/.freee-agent/playwright-profile` で、現在ユーザーだけに権限を限定します。CLI はリポジトリ内部に設定された profile を拒否します。

明示的に監督されたソース開発診断の場合だけ、`FREEE_BROWSER_DIAGNOSTIC_DIR` をリポジトリ外の private な一時ディレクトリに設定します。本人申請の prepare/submit は制御されたフォーム・提出ステップ周辺で番号付き full-page screenshot を保存し、月次 status 読み取りは選択中の勤怠カレンダー状態を保存します。ディレクトリと画像は現在ユーザーだけがアクセスでき、既定では有効になりません。個人情報を確認・マスクせずに commit や公開 Issue へ添付してはいけません。

## Agent Skill

canonical Skill は `skills/freee` にあります。

- Codex：`.agents/skills/freee` が canonical Skill を参照します。
- Claude Code：ユーザーレベル `freee@freee-tools` プラグインがすべてのプロジェクトで canonical Skill を自動読み込みします。`.claude/skills/freee` はソース開発用にのみ残します。

両クライアントは同じ MCP mapping、CLI 設定ガイダンス、安全ルールを共有します。ビジネス操作は MCP を優先し、認証設定と MCP トラブルシューティングでは CLI を使用します。

## ドキュメント

- [ADR-0001：CLI と Agent Skill の基盤](docs/decisions/0001-cli-and-agent-skill.md)
- [ADR-0002：排他的な API / Playwright バックエンド](docs/decisions/0002-api-or-playwright-exclusive-backends.md)
- [ADR-0003：ローカル MCP adapter](docs/decisions/0003-local-mcp-adapter.md)
- [freee HR API 機能一覧](docs/freee-hr-api-capabilities.md)
- [開発 backlog](TODO.md)

## ライセンス

このプロジェクトは [MIT License](LICENSE) で提供されます。
