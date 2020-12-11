import { promisify } from 'util'
import { performance, PerformanceObserver } from 'perf_hooks'

import BrowserstackLocalLauncher from 'browserstack-local'
import logger from '@wdio/logger'

const log = logger('@wdio/browserstack-service')

type BrowserstackLocal = BrowserstackLocalLauncher.Local & {
    pid?: number;
    stop(callback: (err?: any) => void): void;
}

type ExtendedCapabilities = WebDriver.Capabilities & {
    'browserstack.local'?: boolean;
}

type Capabilities = (ExtendedCapabilities | ExtendedCapabilities[])

export default class BrowserstackLauncherService implements WebdriverIO.ServiceInstance {
    options: BrowserstackConfig
    config: WebdriverIO.Config
    browserstackLocal?: BrowserstackLocal
    constructor (options: BrowserstackConfig, capabilities: Capabilities, config: WebdriverIO.Config) {
        this.options = options
        this.config = config
    }

    onPrepare (config?: WebdriverIO.Config, capabilities?: Capabilities) {
        if (!this.options.browserstackLocal) {
            return log.info('browserstackLocal is not enabled - skipping...')
        }

        const opts = {
            key: this.config.key,
            forcelocal: true,
            onlyAutomate: true,
            ...this.options.opts
        }

        this.browserstackLocal = new BrowserstackLocalLauncher.Local()

        if (Array.isArray(capabilities)) {
            capabilities.forEach(capability => {
                capability['browserstack.local'] = true
            })
        } else if (typeof capabilities === 'object') {
            capabilities['browserstack.local'] = true
        } else {
            throw TypeError('Capabilities should be an object or Array!')
        }

        /**
         * measure TestingBot tunnel boot time
         */
        const obs = new PerformanceObserver((list) => {
            const entry = list.getEntries()[0]
            log.info(`Browserstack Local successfully started after ${entry.duration}ms`)
        })
        obs.observe({ entryTypes: ['measure'], buffered: false })

        let timer: NodeJS.Timeout
        performance.mark('tbTunnelStart')
        return Promise.race([
            promisify(this.browserstackLocal.start.bind(this.browserstackLocal))(opts),
            new Promise((resolve, reject) => {
                /* istanbul ignore next */
                timer = setTimeout(function () {
                    reject('Browserstack Local failed to start within 60 seconds!')
                }, 60000)
            })]
        ).then(function (result) {
            clearTimeout(timer)
            performance.mark('tbTunnelEnd')
            performance.measure('bootTime', 'tbTunnelStart', 'tbTunnelEnd')
            return Promise.resolve(result)
        }, function (err) {
            clearTimeout(timer)
            return Promise.reject(err)
        })
    }

    onComplete () {
        if (!this.browserstackLocal || !this.browserstackLocal.isRunning()) {
            return
        }

        if (this.options.forcedStop) {
            return process.kill(this.browserstackLocal.pid as number)
        }

        let timer: NodeJS.Timeout
        return Promise.race([
            new Promise((resolve, reject) => {
                this.browserstackLocal?.stop((err: Error) => {
                    if (err) {
                        return reject(err)
                    }
                    resolve()
                })
            }),
            new Promise((resolve, reject) => {
                /* istanbul ignore next */
                timer = setTimeout(
                    () => reject(new Error('Browserstack Local failed to stop within 60 seconds!')),
                    60000
                )
            })]
        ).then(function (result) {
            clearTimeout(timer)
            return Promise.resolve(result)
        }, function (err) {
            clearTimeout(timer)
            return Promise.reject(err)
        })
    }
}
