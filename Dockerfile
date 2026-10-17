# Een container voor de MCP-server, zodat een directory hem kan starten en
# introspecteren zonder iets over onze machine te weten.
#
# WAAROM DIT BESTAAT. De listing-controle van een MCP-directory wil de server zelf
# opstarten en een introspectie-aanroep doen. Dat is precies wat deze server kan en
# wat onze eigen tests al afdwingen (initialize plus tools/list over echte frames),
# dus dit bestand voegt geen gedrag toe. Het maakt alleen reproduceerbaar hoe je hem
# start, voor iemand die onze repo niet kent.
#
# ethers staat als OPTIONELE afhankelijkheid in package.json en wordt hier wel
# geinstalleerd. Zonder ethers werkt de server gewoon, maar dan kan trede 2 van de
# ladder bij een eip712-aanbod niet gecontroleerd worden en komt die terug als
# ONGEMETEN. In een container is er geen reden om die controle weg te laten.
#
# Bewust GEEN "|| true" achter de install: een mislukte install hoort de build te
# laten falen. Een image die stil zonder ethers draait, geeft stil zwakkere uitslagen,
# en dat is precies het soort stille verzwakking dat deze verifieerder moet vermijden.

FROM node:22-alpine

WORKDIR /app

# Eerst alleen het manifest, zodat een wijziging in de broncode de install-laag niet
# ongeldig maakt.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY bin ./bin
COPY src ./src
COPY vectors ./vectors
COPY CONFORMANCE.md README.md ./

# Niet als root draaien. Deze server opent geen poort en schrijft niets, maar een
# container die als root draait is een cadeau dat niemand nodig heeft.
USER node

# stdio, geen poort: een MCP-client praat over standaard in- en uitvoer. Alles wat
# naar stdout gaat moet een JSON-RPC-frame zijn, dus meldingen gaan naar stderr.
ENTRYPOINT ["node", "src/mcp-server.mjs"]
