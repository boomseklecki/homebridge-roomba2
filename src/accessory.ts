import dorita980, { RobotState, Roomba } from "dorita980";
import { AccessoryConfig, AccessoryPlugin, API, Logging, Service, CharacteristicValue, CharacteristicGetCallback, CharacteristicSetCallback } from "homebridge";

/**
 * How long to wait to connect to Roomba.
 */
const CONNECT_TIMEOUT_MILLIS = 60_000;

/**
 * How long after HomeKit has asked for the plugin's status should we continue frequently monitoring and reporting Roomba's status?
 */
const USER_INTERESTED_MILLIS = 60_000;

/**
 * How long after Roomba has been active should we continue frequently monitoring and reporting Roomba's status?
 */
const AFTER_ACTIVE_MILLIS = 120_000;

/**
 * How long will we wait for the Roomba to send status before giving up?
 */
const STATUS_TIMEOUT_MILLIS = 60_000;

/**
 * Coalesce multiple refreshState requests into one when they're less than this many millis apart.
 */
const REFRESH_STATE_COALESCE_MILLIS = 10_000;

interface Status {
    timestamp: number
    running?: boolean
    docking?: boolean
    charging?: boolean
    /**
     * Paused during a clean cycle.
     */
    paused?: boolean
    batteryLevel?: number
    binFull?: boolean
}

const EMPTY_STATUS: Status = {
    timestamp: 0,
};

type CharacteristicGetter = (callback: CharacteristicGetCallback, context: unknown, connection?: unknown) => void

type CharacteristicValueExtractor = (status: Status) => CharacteristicValue | undefined

const NO_VALUE = new Error("No value");

async function delay(duration: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, duration);
    });
}

export default class RoombaAccessory implements AccessoryPlugin {

    private api: API;
    private log: Logging;
    private name: string;
    private model: string;
    private serialnum: string;
    private blid: string;
    private robotpwd: string;
    private ipaddress: string;
    private cleanBehaviour: "everywhere" | "rooms";
    private mission: object;
    private stopBehaviour: "home" | "pause";
    private debug: boolean;
    private idlePollIntervalMillis: number;

    private accessoryInfo: Service;
    private filterMaintenance: Service;
    private switchService: Service;
    private batteryService: Service;
    private dockService?: Service;
    private runningService?: Service;
    private binService?: Service;
    private dockingService?: Service;
    private homeService?: Service;

    /**
     * The last known state from Roomba, if any.
     */
    private cachedStatus = EMPTY_STATUS;

    private lastUpdatedStatus = EMPTY_STATUS;

    private lastRefreshState = 0;

    /**
     * The currently connected Roomba instance _only_ used in the connect() method.
     */
    private _currentlyConnectedRoomba?: Roomba;

    /**
     * How many requests are currently using the connected Roomba instance.
     */
    private _currentlyConnectedRoombaRequests = 0;

    /**
     * Whether the plugin is actively polling Roomba's state and updating HomeKit
     */
    private currentPollTimeout?: NodeJS.Timeout;

    /**
     * When we think a user / HomeKit was last interested in Roomba's state.
     */
    private userLastInterestedTimestamp?: number;

    /**
     * When we last saw the Roomba active.
     */
    private roombaLastActiveTimestamp?: number;

    /**
     * The duration of the last poll interval used.
     */
    private lastPollInterval?: number;

    public constructor(log: Logging, config: AccessoryConfig, api: API) {
        this.api = api;
        this.debug = !!config.debug;

        this.log = !this.debug
            ? log
            : Object.assign(log, {
                debug: (message: string, ...parameters: unknown[]) => {
                    log.info(`DEBUG: ${message}`, ...parameters);
                },
            });
        this.name = config.name;
        this.model = config.model;
        this.serialnum = config.serialnum;
        this.blid = config.blid;
        this.robotpwd = config.robotpwd;
        this.ipaddress = config.ipaddress;
        this.cleanBehaviour = config.cleanBehaviour !== undefined ? config.cleanBehaviour : "everywhere";
    	this.mission = config.mission;
        this.stopBehaviour = config.stopBehaviour !== undefined ? config.stopBehaviour : "home";
        this.idlePollIntervalMillis = (config.idleWatchInterval * 60_000) || 900_000;

        const showDockAsContactSensor = config.dockContactSensor === undefined ? true : config.dockContactSensor;
        const showRunningAsContactSensor = config.runningContactSensor;
        const showBinStatusAsContactSensor = config.binContactSensor;
        const showDockingAsContactSensor = config.dockingContactSensor;
        const showHomeSwitch = config.homeSwitch;

        const Service = api.hap.Service;

        this.accessoryInfo = new Service.AccessoryInformation();
        this.filterMaintenance = new Service.FilterMaintenance(this.name);
        this.switchService = new Service.Switch(this.name);
        this.switchService.setPrimaryService(true);
        this.batteryService = new Service.Battery(this.name);
        if (showDockAsContactSensor) {
            this.dockService = new Service.ContactSensor(this.name + " Dock", "docked");
        }
        if (showRunningAsContactSensor) {
            this.runningService = new Service.ContactSensor(this.name + " Running", "running");
        }
        if (showBinStatusAsContactSensor) {
            this.binService = new Service.ContactSensor(this.name + " Bin Full", "Full");
        }
        if (showDockingAsContactSensor) {
            this.dockingService = new Service.ContactSensor(this.name + " Docking", "docking");
        }
        if (showHomeSwitch) {
            this.homeService = new Service.Switch(this.name + " Home", "returning");
        }

        const Characteristic = this.api.hap.Characteristic;

        const version: string = require("../package.json").version;

        this.accessoryInfo.setCharacteristic(Characteristic.Manufacturer, "iRobot");
        this.accessoryInfo.setCharacteristic(Characteristic.SerialNumber, this.serialnum);
        this.accessoryInfo.setCharacteristic(Characteristic.Identify, true);
        this.accessoryInfo.setCharacteristic(Characteristic.Name, this.name);
        this.accessoryInfo.setCharacteristic(Characteristic.Model, this.model);
        this.accessoryInfo.setCharacteristic(Characteristic.FirmwareRevision, version);

        this.switchService
            .getCharacteristic(Characteristic.On)
            .on("set", this.setRunningState.bind(this))
            .on("get", this.createCharacteristicGetter("Running status", this.runningStatus));
        this.batteryService
            .getCharacteristic(Characteristic.BatteryLevel)
            .on("get", this.createCharacteristicGetter("Battery level", this.batteryLevelStatus));
        this.batteryService
            .getCharacteristic(Characteristic.ChargingState)
            .on("get", this.createCharacteristicGetter("Charging status", this.chargingStatus));
        this.batteryService
            .getCharacteristic(Characteristic.StatusLowBattery)
            .on("get", this.createCharacteristicGetter("Low Battery status", this.batteryStatus));
        this.filterMaintenance
            .getCharacteristic(Characteristic.FilterChangeIndication)
            .on("get", this.createCharacteristicGetter("Bin status", this.binStatus));

        if (this.dockService) {
            this.dockService
                .getCharacteristic(Characteristic.ContactSensorState)
                .on("get", this.createCharacteristicGetter("Dock status", this.dockedStatus));
        }
        if (this.runningService) {
            this.runningService
                .getCharacteristic(Characteristic.ContactSensorState)
                .on("get", this.createCharacteristicGetter("Running status", this.runningStatus));
        }
        if (this.binService) {
            this.binService
                .getCharacteristic(Characteristic.ContactSensorState)
                .on("get", this.createCharacteristicGetter("Bin status", this.binStatus));
        }
        if (this.dockingService) {
            this.dockingService
                .getCharacteristic(Characteristic.ContactSensorState)
                .on("get", this.createCharacteristicGetter("Docking status", this.dockingStatus));
        }
        if (this.homeService) {
            this.homeService
                .getCharacteristic(Characteristic.On)
                .on("set", this.setDockingState.bind(this))
                .on("get", this.createCharacteristicGetter("Returning Home", this.dockingStatus));
        }

        this.startPolling();
    }

    public identify() {
        this.log.info("Identify requested");
        this.connect(async(error, roomba) => {
            if (error || !roomba) {
                return;
            }
            try {
                await roomba.find();
            } catch (error) {
                this.log.warn("Roomba failed to locate: %s", (error as Error).message);
            }
        });
    }

    public getServices(): Service[] {
        const services: Service[] = [
            this.accessoryInfo,
            this.switchService,
            this.batteryService,
            this.filterMaintenance,
        ];

        if (this.dockService) {
            services.push(this.dockService);
        }
        if (this.runningService) {
            services.push(this.runningService);
        }
        if (this.binService) {
            services.push(this.binService);
        }
        if (this.dockingService) {
            services.push(this.dockingService);
        }
        if (this.homeService) {
            services.push(this.homeService);
        }

        return services;
    }

    /**
     * Refresh our knowledge of Roomba's state by connecting to Roomba and getting its status.
     * @param callback a function to call when the state refresh has completed.
     */
    private refreshState(callback: (success: boolean) => void): void {
        const now = Date.now();
        
        this.connect(async(error, roomba) => {
            if (error || !roomba) {
                this.log.warn("Failed to refresh Roomba's state: %s", error ? error.message : "Unknown");
                callback(false);
                return;
            }

            const startedWaitingForStatus = Date.now();

            /* Wait until we've received a state with all of the information we desire */
            return new Promise<void>((resolve) => {
                let receivedState: RobotState | undefined = undefined;

                const timeout = setTimeout(() => {
                    this.log.debug(
                        "Timeout waiting for full state from Roomba ({}ms). Last state received was: %s",
                        Date.now() - startedWaitingForStatus,
                        receivedState ? JSON.stringify(receivedState) : "<none>",
                    );
                    resolve();
                    callback(false);
                }, STATUS_TIMEOUT_MILLIS);

                const updateState = (state: RobotState) => {
                    receivedState = state;

                    if (this.receivedRobotStateIsComplete(state)) {
                        clearTimeout(timeout);

                        /* NB: the actual state is received and updated in the listener in connect() */
                        this.log.debug(
                            "Refreshed Roomba's state in %ims: %s",
                            Date.now() - now,
                            JSON.stringify(state)
                        );

                        roomba.off("state", updateState);
                        resolve();
                        callback(true);
                    }
                };
                roomba.on("state", updateState);
            });
        });
    }

    private receivedRobotStateIsComplete(state: RobotState) {
        return (state.batPct != undefined && state.bin !== undefined && state.cleanMissionStatus !== undefined);
    }

    private receiveRobotState(state: RobotState) {
        const parsed = this.parseState(state);
        this.mergeCachedStatus(parsed);
        
        return true;
    }

    private connect(callback: (error: Error | null, roomba?: Roomba) => Promise<void>): void {
        const getRoomba = () => {
            if (this._currentlyConnectedRoomba) {
                this._currentlyConnectedRoombaRequests++;
                return this._currentlyConnectedRoomba;
            }

            const roomba = new dorita980.Local(this.blid, this.robotpwd, this.ipaddress);
            this._currentlyConnectedRoomba = roomba;
            this._currentlyConnectedRoombaRequests = 1;

            const onClose = () => {
                if (roomba === this._currentlyConnectedRoomba) {
                    this.log.debug("Connection close received");
                    this._currentlyConnectedRoomba = undefined;
                }
                roomba.off("close", onClose);
            };
            roomba.on("close", onClose);

            const onError = (error: Error) => {
                if (roomba === this._currentlyConnectedRoomba) {
                    this.log.debug("Connection received error: %s", error.message);
                    this._currentlyConnectedRoomba = undefined;
                } else {
                    this.log.debug("Old connection received error: %s", error.message);
                }
                roomba.off("error", onError);
            };
            roomba.on("error", onError);

            roomba.on("state", (state) => {
                this.receiveRobotState(state);
            });
            return roomba;
        };
        const stopUsingRoomba = (roomba: Roomba) => {
            if (roomba !== this._currentlyConnectedRoomba) {
                this.log.warn("Releasing an unexpected Roomba instance");
                roomba.end();
                return;
            }

            this._currentlyConnectedRoombaRequests--;
            if (this._currentlyConnectedRoombaRequests === 0) {
                this._currentlyConnectedRoomba = undefined;

                roomba.end();
            } else {
                this.log.debug("Leaving Roomba instance with %i ongoing requests", this._currentlyConnectedRoombaRequests);
            }
        };

        const roomba = getRoomba();
        if (roomba.connected) {
            this.log.debug("Reusing connected Roomba");

            callback(null, roomba).finally(() => {
                stopUsingRoomba(roomba);
            });
            return;
        }

        let timedOut = false;

        const startConnecting = Date.now();

        const timeout = setTimeout(() => {
            timedOut = true;

            this.log.debug("Timed out after %ims trying to connect to Roomba", Date.now() - startConnecting);

            roomba.end();
            callback(new Error("Connect timed out"));
        }, CONNECT_TIMEOUT_MILLIS);

        this.log.debug("Connecting to Roomba (%i others waiting)...", this._currentlyConnectedRoombaRequests - 1);

        const onConnect = () => {
            roomba.off("connect", onConnect);

            if (timedOut) {
                this.log.debug("Connection established to Roomba after timeout");
                return;
            }

            clearTimeout(timeout);

            this.log.debug("Connected to Roomba in %ims", Date.now() - startConnecting);
            callback(null, roomba).finally(() => {
                stopUsingRoomba(roomba);
            });
        };
        roomba.on("connect", onConnect);
    }

    private setRunningState(powerOn: CharacteristicValue, callback: CharacteristicSetCallback) {
        if (powerOn) {
            this.log.info("Starting Roomba");

            this.connect(async(error, roomba) => {
                if (error || !roomba) {
                    callback(error || new Error("Unknown error"));
                    return;
                }

                try {

                    /* If Roomba is paused in a clean cycle we need to instruct it to resume instead, otherwise we just start a clean. */
                    if (this.cachedStatus.paused) {
                        await roomba.resume();
                    } else {
                        if (this.cleanBehaviour === "rooms") {
                            await roomba.cleanRoom(this.mission);
                            this.log.debug("Roomba is cleaning your rooms");
                        } else {
                            await roomba.clean();
                            this.log.debug("Roomba is running");
                        }
                    }

                    callback();

                    /* After sending an action to Roomba, we start polling to ensure HomeKit has up to date status */
                    this.refreshStatusForUser();
                } catch (error) {
                    this.log.warn("Roomba failed: %s", (error as Error).message);

                    callback(error as Error);
                }
            });
        } else {
            this.log.info("Stopping Roomba");

            this.connect(async(error, roomba) => {
                if (error || !roomba) {
                    callback(error || new Error("Unknown error"));
                    return;
                }

                try {
                    const response = await roomba.getRobotState(["cleanMissionStatus"]);
                    const state = this.parseState(response);

                    if (state.running) {
                        this.log.debug("Roomba is pausing");

                        await roomba.pause();

                        callback();

                        if (this.stopBehaviour === "home") {
                            this.log.debug("Roomba paused, returning to Dock");
                            await this.dockWhenStopped(roomba, 3000);
                        } else {
                            this.log.debug("Roomba is paused");
                        }
                    } else if (state.docking) {
                        this.log.debug("Roomba is docking");
                        await roomba.pause();

                        callback();

                        this.log.debug("Roomba paused");
                    } else if (state.charging) {
                        this.log.debug("Roomba is already docked");
                        callback();
                    } else {
                        this.log.debug("Roomba is not running");
                        callback();
                    }

                    this.refreshStatusForUser();
                } catch (error) {
                    this.log.warn("Roomba failed: %s", (error as Error).message);

                    callback(error as Error);
                }
            });
        }
    }

    private setDockingState(docking: CharacteristicValue, callback: CharacteristicSetCallback) {
        this.log.debug("Setting docking state to %s", JSON.stringify(docking));

        this.connect(async(error, roomba) => {
            if (error || !roomba) {
                callback(error || new Error("Unknown error"));
                return;
            }

            try {
                if (docking) {
                    await roomba.dock();
                    this.log.debug("Roomba is docking");
                } else {
                    await roomba.pause();
                    this.log.debug("Roomba is paused");
                }

                callback();

                /* After sending an action to Roomba, we start polling to ensure HomeKit has up to date status */
                this.refreshStatusForUser();
            } catch (error) {
                this.log.warn("Roomba failed: %s", (error as Error).message);

                callback(error as Error);
            }
        });
    }

    private async dockWhenStopped(roomba: Roomba, pollingInterval: number) {
        try {
            const state = await roomba.getRobotState(["cleanMissionStatus"]);

            switch (state.cleanMissionStatus!.phase) {
                case "stop":
                    this.log.debug("Roomba has stopped, issuing dock request");

                    await roomba.dock();

                    this.log.debug("Roomba docking");

                    this.refreshStatusForUser();

                    break;
                case "run":
                    this.log.debug("Roomba is still running. Will check again in %is", pollingInterval / 1000);

                    await delay(pollingInterval);

                    this.log.debug("Trying to dock again...");
                    await this.dockWhenStopped(roomba, pollingInterval);

                    break;
                default:
                    this.log.debug("Roomba is not running");

                    break;
            }
        } catch (error) {
            this.log.warn("Roomba failed to dock: %s", (error as Error).message);
        }
    }

    /**
     * Creates as a Characteristic getter function that derives the CharacteristicValue from Roomba's status.
     */
    private createCharacteristicGetter(name: string, extractValue: CharacteristicValueExtractor): CharacteristicGetter {
        return (callback: CharacteristicGetCallback) => {
            /* Calculate the max age of cached information based on how often we're refreshing Roomba's status */
            const maxCacheAge = (this.lastPollInterval || 0) + STATUS_TIMEOUT_MILLIS * 2;

            const returnCachedStatus = (status: Status) => {
                const value = extractValue(status);
                if (value === undefined) {
                    this.log.debug("%s: Returning no value (%s old, max %s)", name, millisToString(Date.now() - status.timestamp!), millisToString(maxCacheAge));
                    callback(NO_VALUE);
                } else {
                    this.log.debug("%s: Returning %s (%s old, max %s)", name, String(value), millisToString(Date.now() - status.timestamp!), millisToString(maxCacheAge));
                    callback(null, value);
                }
            };

            this.refreshStatusForUser();

            if (Date.now() - this.cachedStatus.timestamp < maxCacheAge) {
                returnCachedStatus(this.cachedStatus);
            } else {
                /* Wait a short period of time (not too long for Homebridge) for a value to be received by a status check so we can report it */
                setTimeout(() => {
                    if (Date.now() - this.cachedStatus.timestamp < maxCacheAge) {
                        returnCachedStatus(this.cachedStatus);
                    } else {
                        this.log.debug("%s: Returning no value due to timeout", name);
                        callback(NO_VALUE);
                    }
                }, 500);
            }
        };
    }

    /**
     * Merge in changes to the cached status, and update our characteristics so the plugin
     * preemptively reports state back to Homebridge.
     */
    private mergeCachedStatus(status: Partial<Status>) {
        this.setCachedStatus({
            ...this.cachedStatus,
            timestamp: Date.now(),
            ...status,
        });
        if (Object.keys(status).length > 1) {
            this.log.debug("Merged updated state %s => %s", JSON.stringify(status), JSON.stringify(this.cachedStatus));
        }

        if (this.isActive()) {
            this.roombaLastActiveTimestamp = Date.now();
        }
    }

    /**
     * Update the cached status and update our characteristics so the plugin preemptively
     * reports state back to Homebridge.
     */
    private setCachedStatus(status: Status) {
        this.cachedStatus = status;
        this.updateCharacteristics(status);
    }

    private parseState(state: RobotState) {
        const status: Status = {
            timestamp: Date.now(),
        };

        if (state.batPct !== undefined) {
            status.batteryLevel = state.batPct;
        }
        if (state.bin !== undefined) {
            status.binFull = state.bin.full;
        }

        if (state.cleanMissionStatus !== undefined) {
            /* See https://www.openhab.org/addons/bindings/irobot/ for a list of phases */
            switch (state.cleanMissionStatus.phase) {
                case "run":
                    status.running = true;
                    status.charging = false;
                    status.docking = false;

                    break;
                case "charge":
                case "recharge":
                    status.running = false;
                    status.charging = true;
                    status.docking = false;

                    break;
                case "hmUsrDock":
                case "hmMidMsn":
                case "hmPostMsn":
                    status.running = false;
                    status.charging = false;
                    status.docking = true;

                    break;
                case "stop":
                case "stuck":
                case "evac":
                    status.running = false;
                    status.charging = false;
                    status.docking = false;

                    break;
                default:
                    this.log.warn("Unsupported phase: %s", state.cleanMissionStatus!.phase);

                    status.running = false;
                    status.charging = false;
                    status.docking = false;

                    break;
            }
            status.paused = !status.running && state.cleanMissionStatus.cycle == "clean";
        }

        return status;
    }

    private updateCharacteristics(status: Status) {
        // this.log.debug("Updating characteristics for status: %s", JSON.stringify(status));

        const updateCharacteristic = (service: Service, characteristicId: typeof Characteristic.On, extractValue: CharacteristicValueExtractor) => {
            const value = extractValue(status);
            if (value !== undefined) {
                const previousValue = extractValue(this.lastUpdatedStatus);
                if (value !== previousValue) {
                    this.log.debug(
                        "Updating %s %s from %s to %s",
                        service.displayName,
                        service.getCharacteristic(characteristicId).displayName,
                        String(previousValue),
                        String(value),
                    );
                    service.updateCharacteristic(characteristicId, value);
                }
            }
        };

        const Characteristic = this.api.hap.Characteristic;

        updateCharacteristic(this.switchService, Characteristic.On, this.runningStatus);
        updateCharacteristic(this.batteryService, Characteristic.ChargingState, this.chargingStatus);
        updateCharacteristic(this.batteryService, Characteristic.BatteryLevel, this.batteryLevelStatus);
        updateCharacteristic(this.batteryService, Characteristic.StatusLowBattery, this.batteryStatus);
        updateCharacteristic(this.filterMaintenance, Characteristic.FilterChangeIndication, this.binStatus);
        if (this.dockService) {
            updateCharacteristic(this.dockService, Characteristic.ContactSensorState, this.dockedStatus);
        }
        if (this.runningService) {
            updateCharacteristic(this.runningService, Characteristic.ContactSensorState, this.runningStatus);
        }
        if (this.binService) {
            updateCharacteristic(this.binService, Characteristic.ContactSensorState, this.binStatus);
        }
        if (this.dockingService) {
            updateCharacteristic(this.dockingService, Characteristic.ContactSensorState, this.dockingStatus);
        }
        if (this.homeService) {
            updateCharacteristic(this.homeService, Characteristic.On, this.dockingStatus);
        }

        this.lastUpdatedStatus = {
            ...this.lastUpdatedStatus,
            ...status,
        };
    }

    /**
     * Trigger a refresh of Roomba's status for a user.
     */
    private refreshStatusForUser() {
        this.userLastInterestedTimestamp = Date.now();
        this.startPolling(true);
    }

    /**
     * Start polling Roomba's status and reporting updates to HomeKit.
     * We start polling whenever an event occurs, so we update HomeKit promptly
     * when the status changes.
     */
    private startPolling(adhoc?: boolean) {
        const checkStatus = (adhoc: boolean) => {
            const now = Date.now();
            if (!adhoc || now - this.lastRefreshState > REFRESH_STATE_COALESCE_MILLIS) {
                this.lastRefreshState = now;

                if (adhoc) {
                    this.log.debug("Refreshing Roomba's status");
                } else {
                    this.log.debug("Automatically refreshing Roomba's status");
                }

                /* Cancel any existing timeout */
                if (this.currentPollTimeout) {
                    clearTimeout(this.currentPollTimeout);
                    this.currentPollTimeout = undefined;
                }

                this.refreshState(() => {
                    const interval = this.currentPollInterval();
                    this.lastPollInterval = interval;
                    this.log.debug("Will refresh Roomba's status again automatically in %s", millisToString(interval));
        
                    if (this.currentPollTimeout) {
                        clearTimeout(this.currentPollTimeout);
                        this.currentPollTimeout = undefined;
                    }
                    this.currentPollTimeout = setTimeout(() => checkStatus(false), interval);
                });
            }
        };

        checkStatus(adhoc || false);
    }

    private currentPollInterval = () => {
        /* Check if the user is still interested */
        const timeSinceUserLastInterested = Date.now() - (this.userLastInterestedTimestamp || 0);
        if (timeSinceUserLastInterested < USER_INTERESTED_MILLIS) {
            /* HomeKit is actively querying Roomba's status so a user may be interested */
            return 5_000;
        }

        const timeSinceLastActive = Date.now() - (this.roombaLastActiveTimestamp || 0);
        if (this.isActive() || timeSinceLastActive < AFTER_ACTIVE_MILLIS) {
            /* Roomba is actively doing things */
            return 10_000;
        }

        /* Roomba is idle */
        return this.idlePollIntervalMillis;
    };

    private isActive(): boolean {
        return this.cachedStatus.running || this.cachedStatus.docking || false;
    }

    private runningStatus = (status: Status) => status.running === undefined
        ? undefined
        : status.running
            ? 1
            : 0;
    private chargingStatus = (status: Status) => status.charging === undefined
        ? undefined
        : status.charging
            ? this.api.hap.Characteristic.ChargingState.CHARGING
            : this.api.hap.Characteristic.ChargingState.NOT_CHARGING;
    private dockingStatus = (status: Status) => status.docking === undefined
        ? undefined
        : status.docking
            ? this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
    private dockedStatus = (status: Status) => status.charging === undefined
        ? undefined
        : status.charging
            ? this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
            : this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    private batteryLevelStatus = (status: Status) => status.batteryLevel === undefined
        ? undefined
        : status.batteryLevel;
    private binStatus = (status: Status) => status.binFull === undefined
        ? undefined
        : status.binFull
            ? this.api.hap.Characteristic.FilterChangeIndication.CHANGE_FILTER
            : this.api.hap.Characteristic.FilterChangeIndication.FILTER_OK;
    private batteryStatus = (status: Status) => status.batteryLevel === undefined
        ? undefined
        : status.batteryLevel <= 20
            ? this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

}

function millisToString(millis: number): string {
    if (millis < 1_000) {
        return `${millis}ms`;
    } else if (millis < 60_000) {
        return `${Math.round((millis / 1000) * 10) / 10}s`;
    } else {
        return `${Math.round((millis / 60_000) * 10) / 10}m`;
    }
}
