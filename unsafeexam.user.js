
// ==UserScript==
// @name         Tampermonkey Test
// @namespace    test
// @version      1.0
// @match        https://mo9710.schulportal.hessen.de/mod/quiz/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

console.log("test");

(async () => {
    async function sha256(msg) {
        const data = new TextEncoder().encode(msg);
        const hash = await crypto.subtle.digest("SHA-256", data);

        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    }

    function parsePlist(xml) {
        const doc = new DOMParser().parseFromString(xml, "application/xml");

        const parserError = doc.querySelector("parsererror");
        if (parserError) {
            throw new Error("Ungültiges XML: " + parserError.textContent);
        }

        function parseValue(element) {
            switch (element.tagName) {
                case "string":
                    return element.textContent ?? "";

                case "integer":
                    return Number(element.textContent);

                case "real":
                    return Number(element.textContent);

                case "true":
                    return true;

                case "false":
                    return false;

                case "array":
                    return Array.from(element.children).map(parseValue);

                case "dict": {
                    const result = {};
                    const children = Array.from(element.children);

                    for (let i = 0; i < children.length; i += 2) {
                        const keyElement = children[i];
                        const valueElement = children[i + 1];

                        if (!valueElement) {
                            throw new Error(
                                "Fehlender Wert für plist-Key: " +
                                keyElement.textContent
                            );
                        }

                        if (keyElement.tagName !== "key") {
                            throw new Error(
                                `Erwartete <key>, erhalten: <${keyElement.tagName}>`
                            );
                        }

                        const key = keyElement.textContent;
                        result[key] = parseValue(valueElement);
                    }

                    return result;
                }

                default:
                    throw new Error(
                        `Nicht unterstützter plist-Typ: ${element.tagName}`
                    );
            }
        }

        const rootDict = doc.querySelector("plist > dict");

        if (!rootDict) {
            throw new Error("Kein <plist><dict>...</dict></plist> gefunden");
        }

        return parseValue(rootDict);
    }

    function sortConfig(value) {
        if (Array.isArray(value)) {
            return value.map(sortConfig);
        }

        if (
            value !== null &&
            typeof value === "object"
        ) {
            return Object.fromEntries(
                Object.entries(value)
                    .sort(([a], [b]) =>
                        a.toLowerCase().localeCompare(b.toLowerCase())
                    )
                    .map(([key, val]) => [
                        key,
                        sortConfig(val)
                    ])
            );
        }

        return value;
    }

    async function getSEBConfigKeyHash(url, configXml) {
        const config = parsePlist(configXml);

        const sortedConfig = sortConfig(config);

        const json = JSON.stringify(sortedConfig);

        console.log("Parsed config:", config);
        console.log("Serialized JSON:", json);

        const configKey = await sha256(json);

        console.log("Configuration Key:", configKey);

        const cleanUrl = url.split("#")[0];

        console.log("Clean URL:", cleanUrl);
        console.log("Hash input:", cleanUrl + configKey);

        const configKeyHash = await sha256(
            cleanUrl + configKey
        );

        console.log(
            "X-SafeExamBrowser-ConfigKeyHash:",
            configKeyHash
        );

        return configKeyHash;
    }

    async function main() {
        const configLink = document.querySelector(
            'a[title="Konfiguration herunterladen"]'
        );

        if (!configLink) {
            throw new Error(
                'Link "Konfiguration herunterladen" wurde nicht gefunden.'
            );
        }

        const configResponse = await fetch(configLink.href);

        if (!configResponse.ok) {
            throw new Error(
                `Config konnte nicht geladen werden: ${configResponse.status}`
            );
        }

        const configXml = await configResponse.text();

        const url = window.location.href;

        const key = await getSEBConfigKeyHash(
            url,
            configXml
        );

        console.log("Got key:", key);

        const response = await fetch(url, {
            headers: {
                "X-SafeExamBrowser-ConfigKeyHash": key
            }
        });

        if (!response.ok) {
            throw new Error(
                `Seite konnte nicht geladen werden: ${response.status}`
            );
        }

        const newMain = await response.text();

        document.open();
        document.write(newMain);
        document.close();
    }

    try {
        await main();
        window.location.reload()
    } catch (error) {
        console.error("SEB hash error:", error);
    }
})();
