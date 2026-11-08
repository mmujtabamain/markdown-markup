// Every release's step, in order. A release adds its own here (CI refuses a release without one).
import type { Step } from '../index';
import { step_0_2_2 } from './0.2.2';
import { step_0_2_3 } from './0.2.3';
import { step_0_2_4 } from './0.2.4';
import { step_0_2_5 } from './0.2.5';
import { step_0_2_6 } from './0.2.6';
import { step_0_2_7 } from './0.2.7';
import { step_0_2_8 } from './0.2.8';

export const STEPS: Step[] = [step_0_2_2, step_0_2_3, step_0_2_4, step_0_2_5, step_0_2_6, step_0_2_7, step_0_2_8];
