import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeRu from '@angular/common/locales/ru';
import { AppComponent } from './app/app.component';

registerLocaleData(localeRu);

bootstrapApplication(AppComponent, {
  providers: [provideHttpClient(), provideZonelessChangeDetection(), { provide: LOCALE_ID, useValue: 'ru-RU' }],
}).catch(error => console.error(error));
