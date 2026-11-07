import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app';

bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] }).catch((e) => console.error(e));
