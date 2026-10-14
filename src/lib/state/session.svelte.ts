/**
 * OpenStreetMap login with OAuth 2 (PKCE, no client secret) through osm-auth. The login opens
 * a popup that lands on /auth/callback; the token stays in this browser's localStorage.
 */
import { osmAuth } from "osm-auth";

export interface SessionOptions {
	/** OSM website handling OAuth (e.g. https://www.openstreetmap.org). */
	readonly oauthUrl: string;
	/** OSM API (e.g. https://api.openstreetmap.org). */
	readonly apiUrl: string;
	/** Public client id of the OAuth 2 application; empty when not configured. */
	readonly clientId: string;
	/** Absolute URL of the /auth/callback page, as registered for the application. */
	readonly redirectUri: string;
	readonly fetch?: typeof fetch;
}

/** osm-auth methods missing from its type definitions. */
type OsmAuth = InstanceType<typeof osmAuth> & { getAccessToken(): string };

export class Session {
	/** Display name of the logged-in user, once known. */
	userName = $state<string | null>(null);
	loggedIn = $state(false);
	readonly configured: boolean;

	readonly #auth: OsmAuth | null;
	readonly #apiUrl: string;
	readonly #fetch: typeof fetch;

	constructor(options: SessionOptions) {
		this.configured = options.clientId !== "";
		this.#apiUrl = options.apiUrl.replace(/\/+$/, "");
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#auth = this.configured
			? (new osmAuth({
					url: options.oauthUrl.replace(/\/+$/, ""),
					apiUrl: this.#apiUrl,
					client_id: options.clientId,
					redirect_uri: options.redirectUri,
					scope: "read_prefs write_api",
				}) as OsmAuth)
			: null;
		this.loggedIn = this.#auth?.authenticated() ?? false;
		if (this.loggedIn) void this.#loadUser();
	}

	/** The access token for API calls, or null when logged out. */
	token(): string | null {
		return this.#auth?.getAccessToken() || null;
	}

	/** Opens the OSM login popup; resolves once logged in. */
	login(): Promise<void> {
		const auth = this.#auth;
		if (!auth) return Promise.reject(new Error("Login is not configured"));
		return new Promise((resolve, reject) => {
			auth.authenticate((error) => {
				if (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
					return;
				}
				this.loggedIn = true;
				void this.#loadUser();
				resolve();
			});
		});
	}

	logout(): void {
		this.#auth?.logout();
		this.loggedIn = false;
		this.userName = null;
	}

	async #loadUser(): Promise<void> {
		const token = this.token();
		if (!token) return;
		try {
			const response = await this.#fetch(
				`${this.#apiUrl}/api/0.6/user/details.json`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			);
			if (response.status === 401) {
				this.logout();
				return;
			}
			const details = (await response.json()) as {
				user?: { display_name?: string };
			};
			this.userName = details.user?.display_name ?? null;
		} catch {
			// The name is only informative; uploading will report real problems.
		}
	}
}
