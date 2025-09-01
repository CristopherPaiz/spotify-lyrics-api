import { defineEventHandler } from "h3";
import { USER_AGENT } from "../utils";

export default {
	get: defineEventHandler(async (event) => {
		const spDcCookie = (event.context.cloudflare?.env || process.env).SP_DC;

		if (!spDcCookie) {
			return {
				error: "La variable de entorno SP_DC no está configurada en Vercel.",
			};
		}

		try {
			const response = await fetch(
				"https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
				{
					headers: {
						"User-Agent": USER_AGENT,
						Cookie: `sp_dc=${spDcCookie}`,
					},
				}
			);

			const responseBody = await response.text();

			return {
				message: "Respuesta recibida desde Spotify:",
				spotify_status_code: response.status,
				spotify_response_headers: Object.fromEntries(
					response.headers.entries()
				),
				spotify_response_body: responseBody,
			};
		} catch (error) {
			return {
				error: "Falló la petición fetch a Spotify.",
				details: error.message,
			};
		}
	}),
};
