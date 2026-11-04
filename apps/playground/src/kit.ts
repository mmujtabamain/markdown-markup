// The playground's provider: shadcn's components, and components in its style for what it lacks.
import { shadcnComponents, type Kit } from '@mkp/shadcn';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Checkbox } from '@/components/ui/checkbox';
import { CodeBlock } from '@/components/ui/code-block';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { OptionRow } from '@/components/ui/option-row';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Footnote, Heading, List, Paragraph, Quote } from '@/components/ui/typography';

const kit: Kit = {
  Button, Toggle, Switch, Slider, Input, Checkbox, Progress, Separator,
  Tabs, TabsList, TabsTrigger,
  ToggleGroup, ToggleGroupItem,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Tooltip, TooltipTrigger, TooltipContent,
  Popover, PopoverTrigger, PopoverContent,
  Dialog, DialogTrigger, DialogContent, DialogTitle,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  OptionRow, Callout, CodeBlock, Paragraph, Heading, List, Quote, Footnote,
};

export const components = shadcnComponents(kit);
