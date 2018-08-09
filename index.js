const fs = require('fs');
const pmx = require('pmx');
const probe = pmx.probe();

console.log('PID: ', process.pid);

const Server = require('./src/server');

/* Load custom server configuration
*/

let config;

try {
	if (!fs.existsSync('./config.json') && fs.existsSync('./config.json.example')) {
		fs.copyFileSync('./config.json.example', './config.json');
	}

	config = require('./config');
} catch (error) {
	throw new Error(`Unable to parse configuration file\n\n${error.message}`);

	config = {};
}

/* Load available exchanges
*/

if (process.argv.length > 2) {
	config.exchanges = process.argv.slice(2);
} else if (!config.exchanges || !config.exchanges.length) {
	config.exchanges = [];

	fs.readdirSync('./src/exchanges/').forEach(file => {
		/\.js$/.test(file) && config.exchanges.push(file.replace(/\.js$/, ''));
	})
}

for (let name of config.exchanges) {
	const exchange = require('./src/exchanges/' + name);

	config.exchanges[config.exchanges.indexOf(name)] = new exchange(config[name] || {});
}

/* Start server
*/

const server = new Server(config);

/* Metrics
*/

if (process.env.pmx) {
	const listeners = probe.metric({
		name: 'Connections'
	});

	server.on('connections', n => {
		listeners.set(n);
	});

	pmx.action('notice', function(message, reply) {
		if (message && message.trim().length) {
			const alert = {
				type: 'message',
				message: message,
				timestamp: +new Date()
			};

			server.broadcast(alert)

			server.notice = alert;

			reply(`Notice pinned "${message}"`);
		} else if (server.notice) {
			server.notice = null;

			reply(`Notice deleted`);
		}
	});
}

/* Backup server on SIGINT
*/

process.on('SIGINT', function() {
	console.log('SIGINT');

	Promise.all([server.updatePersistence(), server.updateDayTrades()]).then(data => {
		console.log('[server/exit] Goodbye')

		process.exit();
	}).catch(err => {
		console.log(`[server/exit] Something went wrong when executing SIGINT script${err && err.message ? "\n\t" + err.message : ''}`);

		process.exit();
	})
});