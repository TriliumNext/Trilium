# Creating a new option
1.  Go to `options_interface.ts` and add the option to `OptionDefinitions`, specifying its intended data type (boolean, string, number). Note that in the end the option will still be stored as a string, but this aids in type safety across the application.
2.  To add a new option with a set default, go to `options_init.ts` in the server and add a new entry in the `defaultOptions`.
3.  **Make the option adjustable by the client**  
    By default options are not adjustable or visible to the client. To do so, modify `routes/api/options.ts` to add the newly added option to `ALLOWED_OPTIONS`.