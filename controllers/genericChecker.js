import get from "lodash/get.js";
// import { createClient } from "redis";
// const client = createClient();
// await client.connect();

const OPERATORS = {
    ">": (a, b) => a > b,
    "<": (a, b) => a < b,
    ">=": (a, b) => a >= b,
    "<=": (a, b) => a <= b,
    "==": (a, b) => a === b,
    "!=": (a, b) => a !== b,
    "decFracToPer": (a) => (a * 100).toFixed(2),
    "MB-B": (a) => (a * 1024 * 1024),
    "!includes": (a, b) => !b.includes(a),
    "bandwidth": (a, b, c, d) => ((a - c) / (Math.floor((new Date(b).getTime() - new Date(d).getTime()) / 1000))).toFixed(2)
};

const inverseOperator = {
    ">": "<=",
    "<": ">=",
    ">=": "<",
    "<=": ">",
    "==": "!=",
    "!=": "==",
    "!includes": "includes"
};

function convertToBestUnit(value, path = null, unit = "B") {

    if (isNaN(parseFloat(value))) return value;
    if (['cpu_usage', 'docker_stats[].cpu_usage', 'docker_stats[].memory_usage'].includes(path)) return `${value}%`;

    const units = ["B", "KB", "MB", "GB", "TB"];
    let index = units.indexOf(unit.toUpperCase());

    if (index === -1) return null; // invalid input

    let size = value;

    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index++;
    }

    return  path.split("[]")[0] === "network" ?`${size.toFixed(2)} ${units[index]}/s`:`${size.toFixed(2)} ${units[index]}`;
}

function bytesToHuman(bytes, path) {

    if ('cpu_usage' === path) return `${bytes}%`;

    const hasPercent = /percent/i.test(path);
    if (hasPercent) return `${bytes.toFixed(2)}%`;

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(2)} ${units[i]}`;
}

function toBytes(value) {
    const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, '%': 1 };

    const match = value.match(/(\d+(?:\.\d+)?)(?:\s*)([a-zA-Z%]+)(\/[a-zA-Z]+)?/);

    if (!match) return value;

    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    if (!(unit in units)) return null; // FIXED

    return num * units[unit];
}

function humanReadableUptime(uptimeInSeconds) {
    const days = Math.floor(uptimeInSeconds / 86400);
    const hours = Math.floor((uptimeInSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
    const seconds = uptimeInSeconds % 60;
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

let prevState = {};

export async function checkServerHealth(payload, config) {
    if (!config) {
        console.warn("No config found for:", payload.hostname);
        return [];
    }
    //console.log(prevState);
    const results = [];

    for (const [path, rule] of Object.entries(config.thresholds)) {

        const { op, uniOp, critical, severe, attention } = rule;
        let operatorFn = !Array.isArray(op) ? OPERATORS[op] : null;
        let uniOperatorFn = !Array.isArray(uniOp) ? OPERATORS[uniOp] : null;

        // if (!operatorFn) continue; 
        if (operatorFn === undefined) continue;

        try {
            // Handle array paths like docker_stats[].state 
            if (path.includes("[]")) {
                const basePath = path.split("[]")[0];
                const subPath = path.split("[]")?.[1] ? path.split("[]")[1].split(".") : null;
                let items = get(payload, basePath, []);
                items = !Array.isArray(items) ? [items] : items;

                // for (const item of items) {
                for (const [index, item] of items.entries()) {
                    if (!subPath) {
                        // const ip = await client.get(`${payload.hostname}:${basePath}`); // read
                        // const arr = ip ? JSON.parse(ip) : await client.set(`${payload.hostname}:${basePath}`, json.stringify(attention.threshold)); // store
                        if (operatorFn(item, attention.threshold)) {
                            results.push({
                                path,
                                actual: item,
                                expected: `${inverseOperator[op]} ${attention.threshold}`,
                                status: "Attention"
                            });
                        }
                        else if (operatorFn(actualValue, toBytes(severe.threshold))) {
                            results.push({
                                path,
                                actual: bytesToHuman(actualValue, path),
                                expected: `${inverseOperator[op]} ${severe.threshold}`,
                                status: "Severe"
                            });
                        } else if (operatorFn(actualValue, toBytes(attention.threshold))) {
                            results.push({
                                path,
                                actual: bytesToHuman(actualValue, path),
                                expected: `${inverseOperator[op]} ${attention.threshold}`,
                                status: "Attention"
                            });
                        }
                    } else {
                        for (let i = 0; i < op.length; i++) {
                            operatorFn = OPERATORS[op[i]];
                            uniOperatorFn = OPERATORS[uniOp?.[i]];
                            // console.log(payload?.timestamp);
                            // console.log(prevState?.timestamp);
                            // console.log(prevState?.network?.[index]?.[subPath?.[i + 1]]);
                            // // console.log(prevState?.network?.find(n => n.name === item.name)?.[subPath[i + 1]]);
                            // console.log(get(item, subPath[i + 1]));
                            let actualValue = uniOperatorFn ? uniOperatorFn(get(item, subPath[i + 1]), payload?.timestamp, prevState?.network?.[index]?.[subPath?.[i + 1]], prevState?.timestamp) : get(item, subPath[i + 1]);
                            // console.log(actualValue);
                            if (subPath[i + 1] === "memory_usage") {
                                actualValue = ((actualValue / get(item, subPath[i + 2])) * 100).toFixed(2);
                            }
                            if (operatorFn(actualValue, toBytes(critical.threshold[i]))) {
                                results.push({
                                    name: item.name,
                                    path: `${basePath}[].${subPath[i + 1]}`,
                                    actual: convertToBestUnit(actualValue, `${basePath}[].${subPath[i + 1]}`),
                                    expected: `${inverseOperator[op[i]]} ${critical.threshold[i]}`,
                                    status: "Critical"
                                });
                            } else if (operatorFn(actualValue, toBytes(severe.threshold[i]))) {
                                results.push({
                                    name: item.name,
                                    path: `${basePath}[].${subPath[i + 1]}`,
                                    actual: convertToBestUnit(actualValue, `${basePath}[].${subPath[i + 1]}`),
                                    expected: `${inverseOperator[op[i]]} ${severe.threshold[i]}`,
                                    status: "Severe"
                                });
                            } else if (operatorFn(actualValue, toBytes(attention.threshold[i]))) {
                                results.push({
                                    name: item.name,
                                    path: `${basePath}[].${subPath[i + 1]}`,
                                    actual: convertToBestUnit(actualValue, `${basePath}[].${subPath[i + 1]}`),
                                    expected: `${inverseOperator[op[i]]} ${attention.threshold[i]}`,
                                    status: "Attention"
                                });
                            }

                        }
                    }
                }
            } else {
                const actualValue = uniOperatorFn ? uniOperatorFn(get(payload, path)) : get(payload, path);
                //console.log("actualValue:",actualValue);
                if (operatorFn(actualValue, toBytes(critical.threshold))) {
                    results.push({
                        path,
                        actual: bytesToHuman(actualValue, path),
                        expected: `${inverseOperator[op]} ${critical.threshold}`,
                        status: "Critical"
                    });
                } else if (operatorFn(actualValue, toBytes(severe.threshold))) {
                    results.push({
                        path,
                        actual: bytesToHuman(actualValue, path),
                        expected: `${inverseOperator[op]} ${severe.threshold}`,
                        status: "Severe"
                    });
                } else if (operatorFn(actualValue, toBytes(attention.threshold))) {
                    results.push({
                        path,
                        actual: bytesToHuman(actualValue, path),
                        expected: `${inverseOperator[op]} ${attention.threshold}`,
                        status: "Attention"
                    });
                }
            }
        } catch (err) {
            console.error(`❌ Error checking path ${path}: `, err.message);
        }
    }

    prevState = payload;

    return results.length > 0 ? (results.push({
        hostname: payload.hostname,
        uptime: humanReadableUptime(payload.uptime)
    }), results) : null;
}
