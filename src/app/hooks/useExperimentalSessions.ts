import {useSyncExternalStore} from 'react';
import {experimentRegistry} from '../experiment/registry';
export const useExperimentalSessions=()=>useSyncExternalStore(experimentRegistry.subscribe,experimentRegistry.getSnapshot);
