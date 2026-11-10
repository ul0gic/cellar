import View, { configureView } from '@lightstart/light';
import { configureControllers } from '@lightstart/light/controller';
import { syncPlugin } from '@lightstart/light/controller/view';
import { lookupText } from '../text/index.ts';
import { bus } from './bus.ts';

View.use(syncPlugin);
configureControllers({ events: bus });
configureView({ translate: lookupText });
