const fs = require("node:fs");
const { execSync } = require("node:child_process");
const path = require("node:path");
const readline = require("node:readline");
const crypto = require("node:crypto");
const os = require("node:os");
const { Readable } = require("node:stream");

// HELPERS

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

// Check if a command exists in the current environment
const exists = (command) => {
	try {
		const stdout = execSync(
			isWindows ? `where ${command}` : `command -v ${command}`,
			{ stdio: [] },
		);
		return !!stdout;
	} catch {
		return false;
	}
};

// Download a file from a URL and save it to the specified output path
const download = async (url, output) => {
	const res = await fetch(url);
	const file = fs.createWriteStream(output);
	await new Promise((resolve, reject) => {
		Readable.fromWeb(res.body).pipe(file);
		file.on("close", resolve);
		file.on("error", reject);
	});
};

// Throw an error if the patch fails
const throwPatchError = () => {
	console.error("An error occurred while patching the APK.");
	process.exit(1);
};

// Recursively find a file within a directory
const find = (dir, file) => {
	const files = fs.readdirSync(dir);
	for (const f of files) {
		const filePath = path.join(dir, f);
		const stat = fs.statSync(filePath);
		if (stat.isDirectory()) {
			const res = find(filePath, file);
			if (res) return res;
		} else if (f === file) {
			return filePath;
		}
	}
	return null;
};

// Recursively search for a file containing a specific regex in a directory, ignoring specified files
const findContent = (regex, ignore = [], dir = "disassembled", showPerc = false) => {
	const files = fs.readdirSync(dir);
	if (showPerc) process.stdout.write("Searching file to patch... 0%");
	for (const f of files) {
		if (showPerc) {
			const perc = Math.round((files.indexOf(f) / files.length) * 100);
			process.stdout.clearLine(0);
			process.stdout.cursorTo(0);
			process.stdout.write(`Searching file to patch... ${perc}% (${f})`);
		}

		const filePath = path.join(dir, f);
		if (!ignore.includes(filePath)) {
			const stat = fs.statSync(filePath);
			if (stat.isDirectory()) {
				if (!["assets", "kotlin", "lib", "META-INF", "res"].includes(f)) {
					console.log("\x1b[100m[.]\x1b[0m", filePath);
					const res = findContent(regex, ignore, filePath);
					if (res) return res;
				}
			} else if (fs.readFileSync(filePath, "utf-8").match(regex)) {
				console.log("\x1b[44m[o]\x1b[0m", filePath);
				return filePath;
			}
		}
	}
	return null;
};

// Extract a method definition from a file by its name and declaration type
const getMethod = (file, method, declaration = "public static") => {
	const lines = fs.readFileSync(file, "utf-8").split("\n");
	let i = 0;

	while (i < lines.length) {
		if (lines[i].match(new RegExp(`.method ${declaration} ${method}\\(`))) {
			let j = i;
			while (!lines[j].match(".end method")) {
				if (j === lines.length) return null;
				j++;
			}
			return lines.slice(i, j + 1).join("\n");
		}
		i++;
	}

	return null;
};

// Extract a class name from a file path
const extractClassName = (file) => file.split(path.sep).pop().split(".")[0];

// Insert content after a line matching a specified regex pattern within a file
const addAfter = (file, regex, content, n = 1) => {
	console.log("\x1b[42m[+]\x1b[0m", file);

	const lines = fs.readFileSync(file, "utf-8").split("\n");
	let i = 0;
	let line = lines[i];
	while (!line.match(regex) && i < lines.length) {
		i++;
		line = lines[i];
	}

	if (i === lines.length) return false;

	lines.splice(i + n, 0, content);
	fs.writeFileSync(file, lines.join("\n"));
	return true;
};

// Add a new host to the list of hosts to apply authorization to
const authorizeHost = (file) => {
	console.log("\x1b[42m[+]\x1b[0m", file);

	const lines = fs.readFileSync(file, "utf-8").split("\n");
	let i = 0;
	let line = lines[i];
	while (
		!line.match(/const-string(\/jumbo)? v[0-9]+, "wgint\.spotify\.net"/) &&
		i < lines.length
	) {
		i++;
		line = lines[i];
	}

	if (i === lines.length) throwPatchError();

	const wg_line = line;

	const authorizeHost = [];
	while (!line.match(/if-nez/)) {
		authorizeHost.push(line);
		i++;
		line = lines[i];
	}
	authorizeHost.push(lines[i++]);

	const patchedAuthorizeHost = authorizeHost
		.join("\n")
		.replace("wgint.spotify.net", server);

	if (!addAfter(file, wg_line, patchedAuthorizeHost, -1)) throwPatchError();
};

// Patch Spotify Lite
const patchSpotifyLite = () => {
	const urlPattern =
		/const-string v2, "https:\/\/(spclient\.wg\.spotify\.com|lyrics\.natanchiodi\.fr)\/"/;
	const file = findContent(urlPattern);
	if (!file) throwPatchError();

	const className = extractClassName(file);
	const originalConstructor = getMethod(
		file,
		"<init>",
		"public synthetic constructor",
	);
	const patchedConstructor = originalConstructor
		.replace(
			/(.method public synthetic constructor <init>\(.*)\)/,
			"$1Ljava/lang/String;)",
		)
		.replace(
			/iput p1, p0, Lp\/([^;]+);->a:I/,
			`iput p1, p0, Lp/${className};->a:I\n    iput-object p2, p0, Lp/${className};->b:Ljava/lang/String;`,
		);

	if (
		!addAfter(
			file,
			"# instance fields",
			".field public final synthetic b:Ljava/lang/String;",
		) ||
		!addAfter(
			file,
			`    iput p1, p0, Lp/${className};->a:I`,
			`    const-string v0, "https://spclient.wg.spotify.com/"\n    iput-object v0, p0, Lp/${className};->b:Ljava/lang/String;`,
		) ||
		!addAfter(file, "# direct methods", patchedConstructor) ||
		!addAfter(
			file,
			`const-string v2, "https://spclient.wg.spotify.com/"`,
			`    iget-object v2, p0, Lp/${className};->b:Ljava/lang/String;`,
		)
	) {
		throwPatchError();
	}

	//
	const file2 = findContent(
		new RegExp(/iget-object v3, v0, Lp\/([^;]+);->n1:Lp\/([^;]+);/),
	);
	if (!file2) throwPatchError();

	const lines = fs.readFileSync(file2, "utf-8").split("\n");
	let i = 0;
	let line = lines[i];
	while (!line.match(/iget-object v3, v0, Lp\/([^;]+);->n1:Lp\/([^;]+);/)) {
		i++;
		line = lines[i];
	}

	const set_r1 = [];
	while (!line.match(/move-result-object v3/)) {
		set_r1.push(line);
		i++;
		line = lines[i];
	}

	//
	const file3 = findContent(new RegExp(/"androidLibsLyricsProperties"/));
	if (!file3) throwPatchError();

	fs.writeFileSync(
		file3,
		fs
			.readFileSync(file3, "utf-8")
			.replace(/invoke-interface {v11}/, "invoke-interface {v14}"),
	);

	const patched =
		// biome-ignore lint/style/useTemplate: better readability
		`    new-instance v12, Lp/${className};\n` +
		"    const/16 v11, 0x14\n" +
		`    const-string/jumbo v14, "https://${server}"\n` +
		`    invoke-direct {v12, v11, v14}, Lp/${className};-><init>(ILjava/lang/String;)V\n` +
		set_r1
			.join("\n")
			.replace(/iget-object v3, v0/, "iget-object v11, v2")
			.replace(/new-instance v6/, "new-instance v14")
			.replace(/const\/16 v9/, "const/16 v13")
			.replace(
				/invoke-direct {v6, v3, v2, v9}/,
				"invoke-direct {v14, v11, v12, v13}",
			)
			.replace(/invoke-static {v6}/, "invoke-static {v14}")
			.replace(/move-result-object v3/, "move-result-object v14");

	if (!addAfter(file3, "invoke-interface {v14}", patched, -1)) {
		throwPatchError();
	}

	// Authorize new host
	const webgateHelperFile = find("disassembled", "WebgateHelper.smali");
	if (!webgateHelperFile) throwPatchError();

	authorizeHost(webgateHelperFile);
};

// Patch Spotify Stock / Amoled
const patchSpotifyStandard = () => {
	const retrofitUtilFile = find("disassembled", "RetrofitUtil.smali");
	if (retrofitUtilFile) {
		// OLDER VERSIONS

		const originalRetrofitMethod = getMethod(
			retrofitUtilFile,
			"prepareRetrofit",
		);
		const patchedRetrofitMethod = originalRetrofitMethod
			.replace(
				/(.method public static prepareRetrofit\(.*)\)/,
				"$1Ljava/lang/String;)",
			)
			.replace(
				/invoke-static {p0, v0, p1, v1, p2}/,
				"invoke-static {p0, v0, p1, p3, p2}",
			);

		fs.appendFileSync(retrofitUtilFile, patchedRetrofitMethod);

		// Patch class using RetrofitUtil
		const classFile = findContent(new RegExp(/"prepareRetrofit\(/));
		if (!classFile) throwPatchError();

		const className = extractClassName(classFile);
		const originalMethod = getMethod(classFile, "b");
		const patchedMethod = originalMethod
			.replace(/(.method public static b\(.*)\)/, "$1Ljava/lang/String;)")
			.replace(/invoke-static {p0, p1, p2}/, "invoke-static {p0, p1, p2, p3}")
			.replace(/(prepareRetrofit\(.*)\)/, "$1Ljava/lang/String;)");

		fs.appendFileSync(classFile, patchedMethod);

		// Patch file using this class
		const match = new RegExp(`Lp/${className};->b\\((.*)\\)`);
		const file = findContent(match, [classFile]);
		if (!file) throwPatchError();

		lines = fs.readFileSync(file, "utf-8").split("\n");
		i = 0;
		line = lines[i];
		while (!line.match(match) && i < lines.length) {
			i++;
			line = lines[i];
		}

		if (i === lines.length) throwPatchError();

		lines.splice(i, 1);
		lines.splice(i, 0, `    const-string v5, "${server}"\n`);
		lines.splice(
			i + 1,
			0,
			line.replace("}", ", v5}").replace(";)", ";Ljava/lang/String;)"),
		);

		fs.writeFileSync(file, lines.join("\n"));

		// Authorize new host
		const oauthHelperFile = find("disassembled", "OAuthHelper.smali");
		const webgateHelperFile = find("disassembled", "WebgateHelper.smali");
		if (!oauthHelperFile || !webgateHelperFile) throwPatchError();

		authorizeHost(oauthHelperFile);
		authorizeHost(webgateHelperFile);
	} else {
		// NEWER VERSIONS

		let hostFile;
		let lyricsEndpointFile;
		let oauthHelperFile;
		let webgateHelperFile;

		function search(dir = "disassembled") {
			const files = fs.readdirSync(dir);
			for (const f of files) {
				if (
					hostFile &&
					lyricsEndpointFile &&
					oauthHelperFile &&
					webgateHelperFile
				)
					break;

				const filePath = path.join(dir, f);
				const stat = fs.statSync(filePath);
				if (stat.isDirectory()) {
					if (!["assets", "kotlin", "lib", "META-INF", "res"].includes(f)) {
						console.log("\x1b[100m[.]\x1b[0m", filePath);
						search(filePath);
					}
				} else {
					const content = fs.readFileSync(filePath, "utf-8");
					let found = true;

					if (content.match(/"client == null"/)) hostFile = filePath;
					else if (content.match(/color-lyrics/)) lyricsEndpointFile = filePath;
					else if (
						content.match(/const-string(\/jumbo)? v1, "wgint\.spotify\.net"/)
					)
						oauthHelperFile = filePath;
					else if (
						content.match(/const-string(\/jumbo)? v2, "wgint\.spotify\.net"/)
					)
						webgateHelperFile = filePath;
					else found = false;

					if (found) console.log("\x1b[44m[o]\x1b[0m", filePath);
				}
			}
		}

		search();

		if (
			!hostFile ||
			!lyricsEndpointFile ||
			!oauthHelperFile ||
			!webgateHelperFile
		)
			throwPatchError();

		// Create new patched file
		const hostFileClassName = extractClassName(hostFile);
		const latestSmaliClassesFolder = path.join(
			fs
				.readdirSync("disassembled")
				.filter((f) => f.startsWith("smali_classes"))
				.reduce((a, b) =>
					Number.parseInt(a.split("smali_classes")[1]) >
					Number.parseInt(b.split("smali_classes")[1])
						? a
						: b,
				),
			"p",
		);
		const lyricsPatchFile = path.join(
			"disassembled",
			latestSmaliClassesFolder,
			"lyricsPatch.smali",
		);
		const lyricsPatchContent = fs
			.readFileSync(hostFile, "utf-8")
			.replaceAll(hostFileClassName, "lyricsPatch")
			.replace("spclient.wg.spotify.com", server);
		fs.writeFileSync(lyricsPatchFile, lyricsPatchContent);

		// Patch file using this class
		const lyricsEndpointClassName = extractClassName(lyricsEndpointFile);

		const fileToPatch = findContent(
			new RegExp(
				`(?=.*${hostFileClassName})(?=.*${lyricsEndpointClassName})`,
				"s",
			),
			[],
			path.join("disassembled", "smali_classes5", "p"),
			true,
		);
		if (!fileToPatch) throwPatchError();
		fs.writeFileSync(
			fileToPatch,
			fs
				.readFileSync(fileToPatch, "utf-8")
				.replaceAll(hostFileClassName, "lyricsPatch"),
		);

		// Authorize new host
		authorizeHost(oauthHelperFile);
		authorizeHost(webgateHelperFile);
	}
};

// Fetch command-line arguments for server, name, and apk file paths
const args = process.argv.slice(2);
const keystore = { file: null, password: null };
let server = "lyrics.natanchiodi.fr";
let apk;

for (let i = 0; i < args.length; i++) {
	switch (args[i]) {
		case "--server":
			server = args[++i];
			break;
		case "--ks-file":
			keystore.file = args[++i];
			break;
		case "--ks-pass":
			keystore.password = args[++i];
			break;
		case "--apk":
			apk = path.resolve(args[++i]);
			break;
	}
}

// Validate arguments
if (keystore.file && !fs.existsSync(keystore.file)) {
	console.error("The provided keystore file does not exist.");
	process.exit(1);
}

if (keystore.file && !keystore.password) {
	console.error(
		"Please provide a password for the keystore file by using the --ks-pass flag.",
	);
	process.exit(1);
}

if (keystore.password && !keystore.file) {
	console.error(
		"Please provide a path to the keystore file by using the --ks-file flag.",
	);
	process.exit(1);
}

if (apk && !fs.existsSync(apk)) {
	console.error("The provided APK file does not exist.");
	process.exit(1);
}

(async () => {
	// Check if necessary dependencies are available
	const dependencies = ["java", "jar"];
	if (!keystore.file) dependencies.push("keytool");
	for (const dep of dependencies) {
		if (!exists(dep)) {
			console.error(`"${dep}" not found.`);
			console.error("Please install Java Development Kit (JDK)");
			process.exit(1);
		}
	}

	// Prepare temporary working directory
	const tmpDir = path.join(process.cwd(), "tmp-xmanager-patch");
	fs.rmSync(tmpDir, { recursive: true, force: true });
	fs.mkdirSync(tmpDir);
	process.chdir(tmpDir);

	// Download essential tools
	console.log("Downloading required tools...");
	await download(
		"https://bitbucket.org/iBotPeaches/apktool/downloads/apktool_2.10.0.jar",
		"apktool.jar",
	);
	await download(
		`https://dl.google.com/android/repository/build-tools_r34-${isWindows ? "windows" : isMac ? "macosx" : "linux"}.zip`,
		"build-tools.zip",
	);

	// Extract and set permissions for downloaded tools
	execSync("jar xvf build-tools.zip");
	fs.renameSync("android-14", "build-tools");
	fs.chmodSync(`build-tools/zipalign${isWindows ? ".exe" : ""}`, "755");
	fs.chmodSync(`build-tools/apksigner${isWindows ? ".bat" : ""}`, "755");

	// Download latest xManager release if no APK is provided
	if (!apk) {
		console.log("No APK provided. Fetching latest xManager release...");
		await download(
			"https://github.com/Team-xManager/xManager/releases/latest/download/xManager.apk",
			"xManager.apk",
		);
		execSync("java -jar apktool.jar d xManager.apk -o xManager --no-src", {
			stdio: "ignore",
		});

		const stringsXml = fs.readFileSync(
			path.join("xManager", "res", "values", "strings.xml"),
			"utf-8",
		);
		const urlMatch = stringsXml.match(
			/https:\/\/gist\.githubusercontent\.com\/[^<]*/,
		);
		const url = urlMatch ? urlMatch[0] : null;
		if (!url) {
			console.error("Failed to fetch xManager releases.");
			process.exit(1);
		}

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		let alt;
		while (!alt) {
			const choice = await new Promise((resolve) => {
				console.log("Which version of Spotify do you want to patch?");
				console.log("1) Stock");
				console.log("2) Amoled");
				console.log("3) Lite");
				rl.question("Enter your choice: ", resolve);
			});

			switch (choice) {
				case "1":
					alt = "Stock_Patched";
					break;
				case "2":
					alt = "Amoled_Patched";
					break;
				case "3":
					alt = "Lite_Patched";
					break;
				default:
					console.error("Invalid choice.");
					console.log();
					break;
			}
		}

		await download(url, "versions.json");
		const versions = JSON.parse(fs.readFileSync("versions.json", "utf-8"));
		const mirror = versions[alt][versions[alt].length - 1].Mirror;

		if (!mirror.includes("fileport")) {
			console.error(
				"An error occurred while downloading the APK. Please download it manually.",
			);
			console.log(`Download link: ${mirror}`);
			process.exit(1);
		}

		await download(mirror, `${alt}.html`);
		const html = fs.readFileSync(`${alt}.html`, "utf-8");
		const downloadPath = html.match(/data-url="([^"]*)"/)[1];
		await download(`https://fileport.io${downloadPath}`, "input.apk");
	} else {
		fs.copyFileSync(apk, path.join(tmpDir, "input.apk"));
	}

	// Patch Spotify
	console.log("Patching Spotify...");
	execSync(
		"java -jar apktool.jar d input.apk -o disassembled --only-main-classes",
		{
			stdio: "ignore",
		},
	);

	const manifestContent = fs.readFileSync(
		path.join("disassembled", "AndroidManifest.xml"),
		"utf-8",
	);

	if (!manifestContent.match(/com\.spotify\.(music|musix|lite)/)) {
		console.error("The provided APK is not a Spotify APK.");
		process.exit(1);
	}

	const isLiteVersion = manifestContent.match(/com\.spotify\.lite/);

	if (isLiteVersion) {
		patchSpotifyLite();
	} else {
		patchSpotifyStandard();
	}

	// Build patched APK
	console.log("Building patched APK...");
	execSync("java -jar apktool.jar b disassembled -o output.apk", {
		stdio: "ignore",
	});
	execSync(
		`.${path.sep}build-tools${path.sep}zipalign${isWindows ? ".exe" : ""} -p -f 4 output.apk aligned.apk`,
	);

	if (!fs.existsSync("aligned.apk")) {
		console.error("An error occurred while building the patched APK.");
		process.exit(1);
	}

	// Sign APK
	console.log("Signing APK...");
	if (keystore.file && keystore.password) {
		execSync(
			`.${path.sep}build-tools${path.sep}apksigner${isWindows ? ".bat" : ""} sign --ks "${path.resolve(keystore.file)}" --ks-pass "pass:${keystore.password}" --out ..${path.sep}Patched.apk aligned.apk`,
			{
				stdio: "ignore",
			},
		);
	} else {
		const name = os.userInfo().username;
		const password = crypto.randomBytes(32).toString("base64");
		execSync(
			`keytool -genkey -v -keystore keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias "${name}" -storepass ${password} -keypass ${password} -dname "CN=${name}"`,
			{
				stdio: "ignore",
			},
		);
		execSync(
			`.${path.sep}build-tools${path.sep}apksigner${isWindows ? ".bat" : ""} sign --ks keystore.jks --ks-pass "pass:${password}" --out ..${path.sep}Patched.apk aligned.apk`,
			{
				stdio: "ignore",
			},
		);
	}

	// Cleanup
	process.chdir("..");
	fs.rmSync(tmpDir, { recursive: true, force: true });

	console.log(`Patched APK saved as "Patched.apk".`);

	process.exit(0);
})();
