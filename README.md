# venv

venv is a virtual environment and package manager for Python.

> [!WARNING]
> This project is still in early development - expect frequent updates and
> breaking changes.
>
> Use at your own risk!

I made venv because I always forget how to set up a Python virtual environment and the state of package management in Python at the project level leaves a lot to be desired.

## Features

-   Create and manage Python virtual environments
-   Install, uninstall, and update packages
-   Run Python scripts within the virtual environment
-   List installed packages
-   Easy project initialization

## Installation

> [!NOTE]
> Global installation via `bun` or `npm` is not available yet.
> This feature is planned for future releases.

1. Clone the repository:
   ```bash
   git clone https://github.com/username/venv.git
   cd venv
   ```

2. Install dependencies:
   ```bash
   bun i
   ```

3. Build the project:
   ```bash
   bun run build
   ```

4. Add the `./bin` directory to your `PATH` or create a symlink to the
   executable in a directory that's already in your `PATH`.
   ```bash
   ln -s $(pwd)/bin/venv /usr/local/bin/venv
   ```

## Usage

Here are some common commands you can use with venv:

### Initialize a new project

```bash
venv init
```

This command helps you set up a new Python project with a virtual environment.

### Install packages

```bash
venv install <package_name>
```

or

```bash
venv install
```

The first command installs a specific package, while the second installs all
packages listed in `requirements.txt`.

### Run a script

```bash
venv run <script_name>
```

This command runs a Python script within the virtual environment.

### List installed packages

```bash
venv list
```

### Update packages

```bash
venv update
```

### Uninstall a package

```bash
venv uninstall <package_name>
```

### Get help

```bash
venv --help
```

## Development

To set up the development environment:

1. Clone the repository
2. Run `bun install` to install dependencies
3. Use `bun run dev` to run the development version

To build the project:

```bash
bun run build
```

This will create an executable in the `./bin` directory.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT License](LICENSE)
