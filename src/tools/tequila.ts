import { Identity, IdentityRegistrationStatus, TequilapiClient, TequilapiClientFactory } from 'mysterium-vpn-js';
import { log } from './common';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MYSTERIUM_HOST = process.env.MYSTERIUM_HOST || '127.0.0.1';

export interface QuickConnectOptions {
    proxyPort: number;
    retries: number;
}

export const buildNodeClient = async (port: number) => {
    const client = new NodeClient(port);
    return await client.auth();
};

export class NodeClient {
    private api: TequilapiClient;
    private identity: string = '';

    constructor(port: number) {
        this.api = new TequilapiClientFactory(`http://${MYSTERIUM_HOST}:${port}/tequilapi`, 40_000).build();
    }

    public async quickConnectTo(country: string, { proxyPort, retries }: QuickConnectOptions) {
        await this.cancelConnection();
        const proposals = await this.api.findProposals(proposalQuery(country));
        
        try {
            if (proposals.length === 0) {
                log(`No proposals found for country: ${country}`);
                return;
            }

            for (const { providerId } of proposals) {
                log(`connecting to ${country}... (proxyPort: ${proxyPort})`);
                try {
                    // Add delay between attempts
                    await this.delay(1000);
                    await this.api.connectionCreate(this.connectionOptions(providerId, proxyPort));
                    log(`connected to: ${country}! (${providerId})`);
                    return;
                } catch (error: any) {
                    // Log more specific error information
                    log(`Connection error: ${error.message}`);
                    if (error._originalError?.response?.data) {
                        log(`Server response: ${JSON.stringify(error._originalError.response.data)}`);
                    }
                }

                retries -= 1;
                if (retries === 0) {
                    log(`Exhausted all retries for ${country}`);
                    return;
                }
                log(`failed to connect ${country}, retries left: ${retries}`);
            }
        } catch (error: any) {
            log(`Fatal error during quick connect: ${error.message}`);
            throw error;
        }

        log(`could not quick connect to ${country} ${proposals.length === 0 ? '(no proposals found...)' : ''}`);
    }

    public async auth() {
        await this.api.authAuthenticate({ username: 'myst', password: 'qwerty123456' });
        this.identity = await this.unlockFirstIdentity();
        return this;
    }

    // `proxyPort = -1` cancels any active connections
    public async cancelConnection(proxyPort: number = -1) {
        try {
            await this.api.connectionCancel({ proxyPort });
        } catch (ignored: any) {}
    }

    public async info(): Promise<Identity> {
        try {
            return await this.api.identity(this.identity);
        } catch (ignored: any) {
            return EMPTY_IDENTITY;
        }
    }

    private async unlockFirstIdentity() {
        const list = await this.api.identityList();
        const first = list.find(() => true);
        if (!first) {
            throw new Error('no identity present');
        }
        await this.api.identityUnlock(first.id, '');
        return first.id;
    }

    private connectionOptions(providerId: string, proxyPort: number) {
        return {
            serviceType: 'wireguard',
            providerId: providerId,
            consumerId: this.identity,
            connectOptions: { proxyPort: proxyPort },
        };
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const proposalQuery = (country: string) => ({ locationCountry: country, ipType: 'residential', qualityMin: 1.0 });

const EMPTY_IDENTITY = {
    id: '0x',
    hermesId: '0x',
    registrationStatus: IdentityRegistrationStatus.Unknown,
    channelAddress: '0x',
    balance: 0,
    balanceTokens: {
        human: '0',
        wei: '0',
        ether: '0',
    },
    earnings: 0,
    earningsTotal: 0,
    stake: 0,
};
