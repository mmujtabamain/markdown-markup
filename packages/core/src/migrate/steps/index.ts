// Every release's step, in order. A release adds its own here (CI refuses a release without one).
import type { Step } from '../index';
import { step_0_2_2 } from './0.2.2';

export const STEPS: Step[] = [step_0_2_2];
