'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const cacheDir = path.join(process.env.HOME, '.cache', 'discord_bridge');
const namesFilePath = path.join(cacheDir, 'previous_src_node_names');
const infoFlagPath = '/tmp/script_info_flag.txt';

const dirname = process.cwd();

const htmlFilePath = path.join(dirname, 'bridge.html');
const chromiumPath = path.join(dirname, 'chromium');
const emptyAudioPath = path.join(dirname, 'empty.wav');
const goulagPath = path.join(dirname, 'goulag.wav');
const putePath = path.join(dirname, 'pute.wav');

const bridgeHtmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
	<title>Audio Test</title>
</head>
<body>
	<audio id="audio" autoplay loop>
		<source src="file://${emptyAudioPath}" type="audio/wav">
	</audio>
	<audio id="audio" autoplay>
		<source src="file://${goulagPath}" type="audio/wav">
	</audio>
</body>
</html>
`;

//

fs.mkdirSync(cacheDir, { recursive: true });

if (!fs.existsSync(infoFlagPath)) {
	console.info('INFO: You can pass more than one source node name as arguments');
	fs.writeFileSync(infoFlagPath, 'INFO_DISPLAYED');
}

//

async function getSrcNodeNames() {
	const args = process.argv.slice(2);

	if (args.length > 0) return args;

	if (!fs.existsSync(namesFilePath)) return [];

	const entries = fs.readFileSync(namesFilePath, 'utf8').split('\n').filter(Boolean);

	if (entries.length === 0) return [];

	const { selected } = await require('inquirer').prompt([
		{
			type: 'list',
			name: 'selected',
			message: 'Select a source node name:',
			choices: entries
		}
	]);

	return [selected];
}

function getNodesByName(nodeName) {
	let dump = execSync('pw-dump').toString();

	let data;
	while (true) {
		try {
			data = JSON.parse(dump);
			break;
		} catch (err) {
			dump = dump.split('\n').slice(0, -1).join('\n');
		}
	}

	const nodeIds = [];
	data.forEach(obj => {
		if (obj.type !== 'PipeWire:Interface:Node') return;

		const props = obj.info ? obj.info.props : {};
		const name = props['node.name'] || '';
		const nodeId = String(obj.id);

		if (name === nodeName) {
			nodeIds.push(nodeId);
		}
	});

	return nodeIds;
}

function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

//

(async () => {
	const srcNodeNames = await getSrcNodeNames();

	if (srcNodeNames.length === 0) {
		console.error('\x1b[31mERROR\x1b[0m: At least one argument is required');
		console.error('\x1b[32mHINT\x1b[0m: use "alsa_playback.osu!" for osu!');
		process.exit(1);
	}

	const dstNodeName = 'discord_capture';

	const allSrcNodeIds = [];
	const validSrcNames = [];

	for (const name of srcNodeNames) {
		const ids = getNodesByName(name);
		if (ids.length === 0) {
			console.error(`\x1b[38;2;255;165;0mWARNING\x1b[0m: no ${name} node found`);
		} else {
			allSrcNodeIds.push(...ids);
			validSrcNames.push(name);
		}
	}

	if (allSrcNodeIds.length === 0) {
		console.error(`\x1b[31mERROR\x1b[0m: no valid source found`);
		process.exit(1);
	}

	const existing = fs.existsSync(namesFilePath)
		? fs.readFileSync(namesFilePath, 'utf8').split('\n')
		: [];
	const updated = [...new Set([...validSrcNames, ...existing])].filter(Boolean);
	fs.writeFileSync(namesFilePath, updated.join('\n') + '\n');

	//

	let discordCaptureNodes = getNodesByName(dstNodeName);

	//

	fs.writeFileSync(htmlFilePath, bridgeHtmlContent, 'utf8');

	const browserProcess = await spawn(
		chromiumPath,
		['--headless', '--autoplay-policy=no-user-gesture-required', `file://${htmlFilePath}`],
		{
			detached: true,
			stdio: 'ignore'
		}
	);

	//

	let newDiscordCaptureNodes = [...discordCaptureNodes];
	let newDiscordCaptureNode;
	while (true) {
		await delay(100);

		newDiscordCaptureNodes = getNodesByName(dstNodeName);

		if (newDiscordCaptureNodes.length > discordCaptureNodes.length) {
			const newNode = newDiscordCaptureNodes.filter(
				node => !discordCaptureNodes.includes(node)
			);
			if (newNode.length > 0) {
				newDiscordCaptureNode = newNode[0];
				break;
			}
		}
	}

	fs.unlink(htmlFilePath, err => {});

	//

	for (const srcId of allSrcNodeIds) {
		try {
			execSync(`pw-link ${srcId} ${newDiscordCaptureNode}`, { stdio: 'pipe' });
		} catch {}
	}

	process.on('SIGINT', async () => {
		process.stdout.write('\r' + ' '.repeat(process.stdout.columns) + '\r');

		const soxNodeName = 'alsa_playback.sox';
		const soxNodes = getNodesByName(soxNodeName);

		require('play-sound')({}).play(putePath, err => {});

		let newSoxNodes = [...soxNodes];
		let newSoxNode;

		while (true) {
			await delay(100);

			newSoxNodes = getNodesByName(soxNodeName);

			if (newSoxNodes.length > soxNodes.length) {
				const newNode = newSoxNodes.filter(node => !soxNodes.includes(node));
				if (newNode.length > 0) {
					newSoxNode = newNode[0];
					break;
				}
			}
		}

		try {
			execSync(`pw-link ${newSoxNode} ${newDiscordCaptureNode}`, { stdio: 'pipe' });
		} catch {}

		await new Promise(resolve => {
			setTimeout(() => {
				process.kill(browserProcess.pid, 'SIGKILL');
				resolve();
			}, 4000);
		});

		process.exit();
	});

	//

	console.log('🎶 DIRECT AU GOULAG 🎶');
	console.log('✅');
	console.log('Press Ctrl+C to \x1b[38;2;255;105;180mOwO\x1b[0m');
})();
